import type { Env } from "@omniscience/config";
import type { Logger } from "pino";
import Redis from "ioredis";
import { RedisService } from "../redis/redis.service";
import { PendingRegistrationStore, type PendingRegistrationRecord } from "./pending-registration.store";

/**
 * Real-Redis concurrency proof for the Phase 2 Step 3 blocker fix.
 *
 * Every other spec in this module mocks `ioredis` — appropriate for
 * verifying this class's own logic, but incapable of proving atomicity,
 * since a mock has no concurrency semantics of its own. These tests
 * instead run genuinely concurrent operations (`Promise.all`) against a
 * real Redis instance and assert on the actual stored state afterward,
 * which is the only way to demonstrate that the Lua scripts in
 * `pending-registration.store.ts` behave atomically under contention.
 *
 * Requires `REDIS_URL` (or a Redis reachable at `redis://localhost:6379`)
 * — set by the `redis` service container in `.github/workflows/ci.yml`.
 * Skips itself with a clear message if no Redis is reachable, so
 * `pnpm test` still passes for contributors without local infra.
 */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

async function isReachable(url: string): Promise<boolean> {
  const probe = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

describe("PendingRegistrationStore — concurrency (real Redis)", () => {
  let reachable = false;
  let env: Env;
  let logger: Logger;
  let redisService: RedisService;
  let store: PendingRegistrationStore;
  let rawClient: Redis;

  const email = "concurrency-test@example.com";

  const baseRecord: PendingRegistrationRecord = {
    name: "Arceus",
    passwordHash: "argon2-hash",
    otpHash: "argon2-otp-hash",
    otpAttempts: 0,
    otpExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    lastOtpSentAt: new Date(Date.now() - 120_000).toISOString(),
  };

  beforeAll(async () => {
    reachable = await isReachable(REDIS_URL);
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn(
        `PendingRegistrationStore concurrency spec: no Redis reachable at ${REDIS_URL} — skipping. ` +
          "Start a local Redis (e.g. `redis-server`) or run in CI, where the `redis` service container provides one.",
      );
      return;
    }

    env = {
      OTP_TTL_SECONDS: 600,
      OTP_MAX_ATTEMPTS: 5,
      OTP_RESEND_COOLDOWN_SECONDS: 60,
    } as unknown as Env;
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;
    redisService = new RedisService(env, logger);
    await redisService.onModuleInit();
    rawClient = redisService.getClient();
    store = new PendingRegistrationStore(env, redisService);
  });

  afterAll(() => {
    if (reachable) {
      redisService.onModuleDestroy();
    }
  });

  beforeEach(async () => {
    if (!reachable) return;
    await rawClient.del(`auth:pending-registration:${email}`);
  });

  it(
    "never loses an increment across simultaneous failed OTP attempts",
    async () => {
      if (!reachable) return;

      await store.claimSend(email, baseRecord);

      const CONCURRENT_ATTEMPTS = 20;
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_ATTEMPTS }, () => store.recordFailedAttempt(email)),
      );

      // OTP_MAX_ATTEMPTS is 5: exactly 4 attempts can be recorded as
      // "incorrect but retry allowed" (bringing the counter from 0 to 4),
      // and the one that pushes it to 5 reports MAX_ATTEMPTS_EXCEEDED.
      // Every attempt after that finds the key already deleted (NOT_FOUND).
      // If increments were lost to the read-modify-write race this fix
      // replaces, more than 4 calls would report INCREMENTED, or more than
      // one would report MAX_ATTEMPTS_EXCEEDED.
      const incremented = results.filter((r) => r.status === "INCREMENTED");
      const exceeded = results.filter((r) => r.status === "MAX_ATTEMPTS_EXCEEDED");
      const notFound = results.filter((r) => r.status === "NOT_FOUND");

      expect(incremented).toHaveLength(4);
      expect(exceeded).toHaveLength(1);
      expect(notFound).toHaveLength(CONCURRENT_ATTEMPTS - 4 - 1);

      // The attemptsRemaining values handed back must be exactly
      // {4, 3, 2, 1} in some order — one per surviving attempt, with no
      // duplicates (a duplicate would prove a lost increment).
      const attemptsRemainingValues = incremented
        .map((r) => (r as { attemptsRemaining: number }).attemptsRemaining)
        .sort((a, b) => a - b);
      expect(attemptsRemainingValues).toEqual([1, 2, 3, 4]);

      await expect(rawClient.exists(`auth:pending-registration:${email}`)).resolves.toBe(0);
    },
    20_000,
  );

  it(
    "OTP_MAX_ATTEMPTS cannot be bypassed by concurrent guesses",
    async () => {
      if (!reachable) return;

      await store.claimSend(email, baseRecord);

      const results = await Promise.all(
        Array.from({ length: 50 }, () => store.recordFailedAttempt(email)),
      );

      const incremented = results.filter((r) => r.status === "INCREMENTED");
      expect(incremented.length).toBeLessThanOrEqual(env.OTP_MAX_ATTEMPTS - 1);
    },
    20_000,
  );

  it(
    "failed OTP attempts preserve TTL and never extend it",
    async () => {
      if (!reachable) return;

      await store.claimSend(email, baseRecord);
      const ttlBefore = await rawClient.ttl(`auth:pending-registration:${email}`);
      expect(ttlBefore).toBeGreaterThan(0);

      // Force the TTL down so a KEEPTTL bug (or a bug that re-applies a
      // fresh EX) would be obvious rather than hidden by the 600s window.
      await rawClient.expire(`auth:pending-registration:${email}`, 5);

      await store.recordFailedAttempt(email);
      const ttlAfter = await rawClient.ttl(`auth:pending-registration:${email}`);

      expect(ttlAfter).toBeGreaterThan(0);
      expect(ttlAfter).toBeLessThanOrEqual(5);
    },
    20_000,
  );

  it(
    "simultaneous resend claims cannot both succeed within the cooldown",
    async () => {
      if (!reachable) return;

      // No existing record: the first successful claim wins outright, and
      // every other concurrent caller must be told to wait — none of them
      // may also succeed within the same cooldown window. `lastOtpSentAt`
      // is set to "now" per call, mirroring how `AuthService.issueOtp()`
      // stamps it at call time in the real flow.
      const CONCURRENT_CLAIMS = 20;
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_CLAIMS }, (_, i) =>
          store.claimSend(email, {
            ...baseRecord,
            otpHash: `hash-${i}`,
            lastOtpSentAt: new Date().toISOString(),
          }),
        ),
      );

      const ok = results.filter((r) => r.status === "OK");
      const cooldown = results.filter((r) => r.status === "COOLDOWN");

      expect(ok).toHaveLength(1);
      expect(cooldown).toHaveLength(CONCURRENT_CLAIMS - 1);
    },
    20_000,
  );
});
