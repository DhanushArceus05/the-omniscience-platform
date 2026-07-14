import type { Env } from "@omniscience/config";
import type { Logger } from "pino";
import Redis from "ioredis";
import { RedisService } from "../redis/redis.service";
import { PasswordHasherService } from "./password-hasher.service";
import { RefreshTokenStore } from "./refresh-token.store";

/**
 * Real-Redis concurrency proof for Phase 2 Step 4's refresh-token
 * rotation, mirroring `pending-registration.store.concurrency.spec.ts`'s
 * rationale: a mocked `ioredis` has no concurrency semantics of its own,
 * so it cannot prove that a refresh token is genuinely single-use under
 * contention. This runs real concurrent `consume()` calls for the same
 * token against a real Redis instance.
 *
 * Requires `REDIS_URL` (or a Redis reachable at `redis://localhost:6379`)
 * — set by the `redis` service container in `.github/workflows/ci.yml`.
 * Skips its assertions (passes trivially, with a console warning) if no
 * Redis is reachable, so `pnpm test` still passes without local infra.
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

describe("RefreshTokenStore — concurrency (real Redis)", () => {
  let reachable = false;
  let env: Env;
  let redisService: RedisService;
  let passwordHasher: PasswordHasherService;
  let store: RefreshTokenStore;

  beforeAll(async () => {
    reachable = await isReachable(REDIS_URL);
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn(
        `RefreshTokenStore concurrency spec: no Redis reachable at ${REDIS_URL} — skipping. ` +
          "Start a local Redis (e.g. `redis-server`) or run in CI, where the `redis` service container provides one.",
      );
      return;
    }

    env = { JWT_REFRESH_TTL_SECONDS: 604800 } as unknown as Env;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;
    redisService = new RedisService(env, logger);
    await redisService.onModuleInit();
    passwordHasher = new PasswordHasherService();
    store = new RefreshTokenStore(env, redisService, passwordHasher);
  });

  afterAll(() => {
    if (reachable) {
      redisService.onModuleDestroy();
    }
  });

  it(
    "a refresh token can be consumed exactly once, even under concurrent requests",
    async () => {
      if (!reachable) return;

      const issued = await store.issue("user_1");

      const CONCURRENT_CONSUMERS = 20;
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_CONSUMERS }, () => store.consume(issued.token)),
      );

      const ok = results.filter((r) => r.status === "OK");
      const notFound = results.filter((r) => r.status === "NOT_FOUND");

      // Exactly one of 20 simultaneous requests for the same token
      // succeeds; every other one — including a genuine replay attempt —
      // is told the token doesn't exist. If the underlying GETDEL weren't
      // atomic, more than one concurrent caller could observe the record
      // before either deleted it.
      expect(ok).toHaveLength(1);
      expect(notFound).toHaveLength(CONCURRENT_CONSUMERS - 1);
      expect((ok[0] as { userId: string }).userId).toBe("user_1");
    },
    20_000,
  );

  it(
    "a consumed token cannot be replayed afterward",
    async () => {
      if (!reachable) return;

      const issued = await store.issue("user_2");
      const first = await store.consume(issued.token);
      const replay = await store.consume(issued.token);

      expect(first).toEqual({ status: "OK", userId: "user_2" });
      expect(replay).toEqual({ status: "NOT_FOUND" });
    },
    20_000,
  );
});
