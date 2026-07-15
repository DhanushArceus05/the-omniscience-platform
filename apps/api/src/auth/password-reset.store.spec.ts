import type { Env } from "@omniscience/config";
import type Redis from "ioredis";
import { RedisService } from "../redis/redis.service";
import { PasswordResetStore, type PasswordResetRecord } from "./password-reset.store";

describe("PasswordResetStore", () => {
  const env = {
    OTP_TTL_SECONDS: 600,
    OTP_MAX_ATTEMPTS: 5,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
  } as unknown as Env;
  const get = jest.fn();
  const del = jest.fn();
  const evalFn = jest.fn();
  const client = { get, del, eval: evalFn } as unknown as Redis;
  const redisService = { getClient: () => client } as unknown as RedisService;

  const record: PasswordResetRecord = {
    userId: "user_1",
    otpHash: "argon2-otp-hash",
    otpAttempts: 0,
    otpExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    lastOtpSentAt: new Date().toISOString(),
  };

  let store: PasswordResetStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new PasswordResetStore(env, redisService);
  });

  describe("get", () => {
    it("returns null when no record exists", async () => {
      get.mockResolvedValue(null);

      await expect(store.get("user@example.com")).resolves.toBeNull();
      expect(get).toHaveBeenCalledWith("auth:password-reset:user@example.com");
    });

    it("returns the parsed record, stripping the internal epoch-ms mirrors", async () => {
      get.mockResolvedValue(
        JSON.stringify({
          ...record,
          otpExpiresAtMs: new Date(record.otpExpiresAt).getTime(),
          lastOtpSentAtMs: new Date(record.lastOtpSentAt).getTime(),
        }),
      );

      await expect(store.get("user@example.com")).resolves.toEqual(record);
    });
  });

  describe("claimSend", () => {
    it("runs the claim script with the key, cooldown, ttl and JSON-encoded record", async () => {
      evalFn.mockResolvedValue(["OK"]);

      const result = await store.claimSend("user@example.com", record);

      expect(result).toEqual({ status: "OK" });
      expect(evalFn).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "auth:password-reset:user@example.com",
        60,
        600,
        expect.any(Number),
        expect.stringContaining(record.otpHash),
      );
    });

    it("returns a COOLDOWN result with the rounded-up retry time", async () => {
      evalFn.mockResolvedValue(["COOLDOWN", "12.3"]);

      const result = await store.claimSend("user@example.com", record);

      expect(result).toEqual({ status: "COOLDOWN", retryAfterSeconds: 13 });
    });

    it("throws on an unrecognized script result", async () => {
      evalFn.mockResolvedValue(["SOMETHING_ELSE"]);

      await expect(store.claimSend("user@example.com", record)).rejects.toThrow(
        /unexpected claimSend result/,
      );
    });
  });

  describe("recordFailedAttempt", () => {
    it("runs the attempt script with the key, max attempts and now", async () => {
      evalFn.mockResolvedValue(["INCREMENTED", "3"]);

      const result = await store.recordFailedAttempt("user@example.com");

      expect(result).toEqual({ status: "INCREMENTED", attemptsRemaining: 3 });
      expect(evalFn).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "auth:password-reset:user@example.com",
        5,
        expect.any(Number),
      );
    });

    it("returns NOT_FOUND when no record exists", async () => {
      evalFn.mockResolvedValue(["NOT_FOUND"]);
      await expect(store.recordFailedAttempt("user@example.com")).resolves.toEqual({
        status: "NOT_FOUND",
      });
    });

    it("returns EXPIRED when the script deleted an expired record", async () => {
      evalFn.mockResolvedValue(["EXPIRED"]);
      await expect(store.recordFailedAttempt("user@example.com")).resolves.toEqual({
        status: "EXPIRED",
      });
    });

    it("returns MAX_ATTEMPTS_EXCEEDED when the limit is hit", async () => {
      evalFn.mockResolvedValue(["MAX_ATTEMPTS_EXCEEDED"]);
      await expect(store.recordFailedAttempt("user@example.com")).resolves.toEqual({
        status: "MAX_ATTEMPTS_EXCEEDED",
      });
    });

    it("throws on an unrecognized script result", async () => {
      evalFn.mockResolvedValue(["SOMETHING_ELSE"]);

      await expect(store.recordFailedAttempt("user@example.com")).rejects.toThrow(
        /unexpected recordFailedAttempt result/,
      );
    });
  });

  it("deletes a record by key", async () => {
    await store.delete("user@example.com");

    expect(del).toHaveBeenCalledWith("auth:password-reset:user@example.com");
  });
});
