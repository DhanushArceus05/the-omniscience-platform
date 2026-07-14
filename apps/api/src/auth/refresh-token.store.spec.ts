import type { Env } from "@omniscience/config";
import type Redis from "ioredis";
import { RedisService } from "../redis/redis.service";
import { PasswordHasherService } from "./password-hasher.service";
import { RefreshTokenStore } from "./refresh-token.store";

describe("RefreshTokenStore", () => {
  const env = { JWT_REFRESH_TTL_SECONDS: 604800 } as unknown as Env;
  const set = jest.fn();
  const del = jest.fn();
  const evalFn = jest.fn();
  const client = { set, del, eval: evalFn } as unknown as Redis;
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
    it("stores a hashed secret with the configured TTL and returns an opaque tokenId.secret token", async () => {
      (passwordHasher.hash as jest.Mock).mockResolvedValue("hashed-secret");

      const result = await store.issue("user_1");

      expect(result.expiresInSeconds).toBe(604800);
      const [tokenId, secret] = result.token.split(".");
      expect(tokenId).toHaveLength(36); // randomUUID
      expect(secret).toBeDefined();
      expect((secret as string).length).toBeGreaterThan(20);

      expect(set).toHaveBeenCalledWith(
        `auth:refresh-token:${tokenId}`,
        JSON.stringify({ userId: "user_1", secretHash: "hashed-secret" }),
        "EX",
        604800,
      );
      // The raw secret is hashed before storage — never stored verbatim.
      expect(passwordHasher.hash).toHaveBeenCalledWith(secret);
    });
  });

  describe("consume", () => {
    it("returns OK with the userId when the token is valid", async () => {
      evalFn.mockResolvedValue(JSON.stringify({ userId: "user_1", secretHash: "hashed-secret" }));
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);

      const result = await store.consume("token-id.the-secret");

      expect(result).toEqual({ status: "OK", userId: "user_1" });
      expect(evalFn).toHaveBeenCalledWith(expect.any(String), 1, "auth:refresh-token:token-id");
      expect(passwordHasher.verify).toHaveBeenCalledWith("hashed-secret", "the-secret");
    });

    it("returns NOT_FOUND when the atomic GETDEL finds no record", async () => {
      evalFn.mockResolvedValue(false);

      await expect(store.consume("token-id.the-secret")).resolves.toEqual({ status: "NOT_FOUND" });
      expect(passwordHasher.verify).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the secret doesn't match the stored hash", async () => {
      evalFn.mockResolvedValue(JSON.stringify({ userId: "user_1", secretHash: "hashed-secret" }));
      (passwordHasher.verify as jest.Mock).mockResolvedValue(false);

      await expect(store.consume("token-id.wrong-secret")).resolves.toEqual({
        status: "NOT_FOUND",
      });
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
    it("deletes the record for a well-formed token", async () => {
      await store.revoke("token-id.the-secret");

      expect(del).toHaveBeenCalledWith("auth:refresh-token:token-id");
    });

    it("is a no-op for a malformed token", async () => {
      await store.revoke("no-separator");

      expect(del).not.toHaveBeenCalled();
    });
  });
});
