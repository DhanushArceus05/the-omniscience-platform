import type { Env } from "@omniscience/config";
import type Redis from "ioredis";
import { RedisService } from "../redis/redis.service";
import { PasswordHasherService } from "./password-hasher.service";
import { RefreshTokenStore } from "./refresh-token.store";

describe("RefreshTokenStore", () => {
  const env = { JWT_REFRESH_TTL_SECONDS: 604800 } as unknown as Env;
  const set = jest.fn();
  const get = jest.fn();
  const del = jest.fn();
  const evalFn = jest.fn();
  const sadd = jest.fn();
  const srem = jest.fn();
  const smembers = jest.fn();
  const sismember = jest.fn();
  const expire = jest.fn();
  const client = {
    set,
    get,
    del,
    eval: evalFn,
    sadd,
    srem,
    smembers,
    sismember,
    expire,
  } as unknown as Redis;
  const redisService = { getClient: () => client } as unknown as RedisService;
  const passwordHasher = {
    hash: jest.fn(),
    verify: jest.fn(),
  } as unknown as PasswordHasherService;

  let store: RefreshTokenStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new RefreshTokenStore(env, redisService, passwordHasher);
  });

  describe("issue", () => {
    it("stores a hashed secret with the configured TTL, returns an opaque tokenId.secret token, and indexes the session", async () => {
      (passwordHasher.hash as jest.Mock).mockResolvedValue("hashed-secret");
      const before = Date.now();

      const result = await store.issue("user_1");

      expect(result.expiresInSeconds).toBe(604800);
      const [tokenId, secret] = result.token.split(".");
      expect(tokenId).toHaveLength(36); // randomUUID
      expect(secret).toBeDefined();
      expect((secret as string).length).toBeGreaterThan(20);

      expect(set).toHaveBeenCalledTimes(1);
      const [key, value, exFlag, ttl] = set.mock.calls[0] as [string, string, string, number];
      expect(key).toBe(`auth:refresh-token:${tokenId}`);
      expect(exFlag).toBe("EX");
      expect(ttl).toBe(604800);
      const stored = JSON.parse(value) as { userId: string; secretHash: string; createdAt: string };
      expect(stored.userId).toBe("user_1");
      expect(stored.secretHash).toBe("hashed-secret");
      expect(new Date(stored.createdAt).getTime()).toBeGreaterThanOrEqual(before);

      // The raw secret is hashed before storage — never stored verbatim.
      expect(passwordHasher.hash).toHaveBeenCalledWith(secret);

      // Step 7 session index: the tokenId is added to the user's index
      // set, and the index's TTL is refreshed to the same window.
      expect(sadd).toHaveBeenCalledWith(`auth:refresh-token-index:user_1`, tokenId);
      expect(expire).toHaveBeenCalledWith(`auth:refresh-token-index:user_1`, 604800);
    });
  });

  describe("consume", () => {
    it("returns OK with the userId when the token is valid, and prunes the session index", async () => {
      evalFn.mockResolvedValue(
        JSON.stringify({ userId: "user_1", secretHash: "hashed-secret", createdAt: "2026-01-01T00:00:00.000Z" }),
      );
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);

      const result = await store.consume("token-id.the-secret");

      expect(result).toEqual({ status: "OK", userId: "user_1" });
      expect(evalFn).toHaveBeenCalledWith(expect.any(String), 1, "auth:refresh-token:token-id");
      expect(passwordHasher.verify).toHaveBeenCalledWith("hashed-secret", "the-secret");
      expect(srem).toHaveBeenCalledWith("auth:refresh-token-index:user_1", "token-id");
    });

    it("returns NOT_FOUND when the atomic GETDEL finds no record", async () => {
      evalFn.mockResolvedValue(false);

      await expect(store.consume("token-id.the-secret")).resolves.toEqual({ status: "NOT_FOUND" });
      expect(passwordHasher.verify).not.toHaveBeenCalled();
      expect(srem).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the secret doesn't match the stored hash", async () => {
      evalFn.mockResolvedValue(JSON.stringify({ userId: "user_1", secretHash: "hashed-secret" }));
      (passwordHasher.verify as jest.Mock).mockResolvedValue(false);

      await expect(store.consume("token-id.wrong-secret")).resolves.toEqual({
        status: "NOT_FOUND",
      });
      expect(srem).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND for a malformed token without calling Redis", async () => {
      await expect(store.consume("no-separator")).resolves.toEqual({ status: "NOT_FOUND" });
      expect(evalFn).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND for a token with an empty tokenId or empty secret", async () => {
      await expect(store.consume(".secret")).resolves.toEqual({ status: "NOT_FOUND" });
      await expect(store.consume("token-id.")).resolves.toEqual({ status: "NOT_FOUND" });
      expect(evalFn).not.toHaveBeenCalled();
    });
  });

  describe("revoke", () => {
    it("deletes the record for a well-formed token and prunes the session index", async () => {
      get.mockResolvedValue(JSON.stringify({ userId: "user_1", secretHash: "hashed-secret" }));

      await store.revoke("token-id.the-secret");

      expect(get).toHaveBeenCalledWith("auth:refresh-token:token-id");
      expect(del).toHaveBeenCalledWith("auth:refresh-token:token-id");
      expect(srem).toHaveBeenCalledWith("auth:refresh-token-index:user_1", "token-id");
    });

    it("deletes the record but skips the index prune when the record no longer exists", async () => {
      get.mockResolvedValue(null);

      await store.revoke("token-id.the-secret");

      expect(del).toHaveBeenCalledWith("auth:refresh-token:token-id");
      expect(srem).not.toHaveBeenCalled();
    });

    it("is a no-op for a malformed token", async () => {
      await store.revoke("no-separator");

      expect(get).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });
  });

  describe("listSessions", () => {
    it("returns active sessions newest-first, pruning stale index entries", async () => {
      smembers.mockResolvedValue(["token-a", "token-b", "token-c"]);
      get.mockImplementation((key: string) => {
        if (key === "auth:refresh-token:token-a") {
          return Promise.resolve(
            JSON.stringify({ userId: "user_1", secretHash: "h", createdAt: "2026-01-01T00:00:00.000Z" }),
          );
        }
        if (key === "auth:refresh-token:token-b") {
          return Promise.resolve(
            JSON.stringify({ userId: "user_1", secretHash: "h", createdAt: "2026-01-02T00:00:00.000Z" }),
          );
        }
        // token-c's real key already expired.
        return Promise.resolve(null);
      });

      const sessions = await store.listSessions("user_1");

      expect(sessions).toEqual([
        { tokenId: "token-b", createdAt: "2026-01-02T00:00:00.000Z" },
        { tokenId: "token-a", createdAt: "2026-01-01T00:00:00.000Z" },
      ]);
      expect(srem).toHaveBeenCalledWith("auth:refresh-token-index:user_1", "token-c");
    });

    it("returns an empty list when the user has no active sessions", async () => {
      smembers.mockResolvedValue([]);

      await expect(store.listSessions("user_1")).resolves.toEqual([]);
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe("revokeSession", () => {
    it("revokes a session that belongs to the caller", async () => {
      sismember.mockResolvedValue(1);
      del.mockResolvedValue(1);

      const result = await store.revokeSession("user_1", "token-a");

      expect(sismember).toHaveBeenCalledWith("auth:refresh-token-index:user_1", "token-a");
      expect(del).toHaveBeenCalledWith("auth:refresh-token:token-a");
      expect(srem).toHaveBeenCalledWith("auth:refresh-token-index:user_1", "token-a");
      expect(result).toBe(true);
    });

    it("returns false without touching Redis further when tokenId isn't the caller's own", async () => {
      sismember.mockResolvedValue(0);

      const result = await store.revokeSession("user_1", "someone-elses-token");

      expect(result).toBe(false);
      expect(del).not.toHaveBeenCalled();
    });

    it("returns false when the index entry is stale (the real key was already gone)", async () => {
      sismember.mockResolvedValue(1);
      del.mockResolvedValue(0);

      const result = await store.revokeSession("user_1", "token-a");

      expect(result).toBe(false);
      expect(srem).toHaveBeenCalledWith("auth:refresh-token-index:user_1", "token-a");
    });
  });

  describe("revokeAllForUser", () => {
    it("deletes every active session and the index itself, returning the count", async () => {
      smembers.mockResolvedValue(["token-a", "token-b"]);

      const result = await store.revokeAllForUser("user_1");

      expect(del).toHaveBeenCalledWith("auth:refresh-token:token-a", "auth:refresh-token:token-b");
      expect(del).toHaveBeenCalledWith("auth:refresh-token-index:user_1");
      expect(result).toBe(2);
    });

    it("returns 0 and skips deletes when the user has no active sessions", async () => {
      smembers.mockResolvedValue([]);

      const result = await store.revokeAllForUser("user_1");

      expect(result).toBe(0);
      expect(del).not.toHaveBeenCalled();
    });
  });
});
