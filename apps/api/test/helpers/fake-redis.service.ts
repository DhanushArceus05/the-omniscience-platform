import type Redis from "ioredis";

/**
 * Shared, in-memory stand-in for a real Redis client, used across every
 * e2e spec that boots the real `AppModule` (which, via `AuthModule`,
 * always needs a `RedisService` regardless of which routes a given
 * suite actually exercises).
 *
 * Implements `GET`/`SET`/`DEL` plus `EVAL` for **every** atomic Lua
 * script currently in the codebase:
 * - `PendingRegistrationStore` (Step 3): `pending-registration-claim-send`,
 *   `pending-registration-record-failed-attempt`.
 * - `PasswordResetStore` (Step 5): `password-reset-claim-send`,
 *   `password-reset-record-failed-attempt` — structurally identical to
 *   the pending-registration pair, so they share a branch below.
 * - `RefreshTokenStore` (Step 4): `refresh-token-consume`.
 *
 * Also implements the small Set-command surface (`SADD`/`SREM`/
 * `SMEMBERS`/`SISMEMBER`/`EXPIRE`) `RefreshTokenStore` uses (Step 7) to
 * maintain each user's session index — a real in-memory `Map<string,
 * Set<string>>`, separate from the string-keyed store above, since Redis
 * itself keeps Sets and strings in distinct keyspaces internally too.
 *
 * This is a single source of truth specifically so that a step whose
 * routes don't call Redis directly (e.g. Step 6's `/users/me` routes,
 * which only need `JwtAuthGuard`'s stateless JWT verification) still
 * gets a `RedisService` that can correctly service whatever *other*
 * routes the same test app boots — e.g. `/auth/register` during e2e
 * setup — instead of every e2e file needing to re-derive which scripts
 * it personally needs to support.
 *
 * This fake never runs concurrent requests (supertest sends them one at
 * a time), so it only needs to reproduce each script's *logic*, not its
 * atomicity — atomicity itself is proven separately, against real
 * Redis, in `pending-registration.store.concurrency.spec.ts`,
 * `refresh-token.store.concurrency.spec.ts`, and
 * `password-reset.store.concurrency.spec.ts`. Dispatches on the
 * `-- SCRIPT: ...` marker comment each real script starts with, so this
 * fake doesn't have to parse or interpret Lua.
 */
export class InMemoryRedisClient {
  private readonly store = new Map<string, { value: string; expiresAtMs: number | null }>();
  private readonly sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== null && entry.expiresAtMs < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ..._options: unknown[]): Promise<"OK"> {
    this.store.set(key, { value, expiresAtMs: null });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted += 1;
      if (this.sets.delete(key)) deleted += 1;
    }
    return deleted;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) added += 1;
      set.add(member);
    }
    this.sets.set(key, set);
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed += 1;
    }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async sismember(key: string, member: string): Promise<number> {
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }

  async expire(_key: string, _ttlSeconds: number): Promise<number> {
    // This fake never expires string keys by wall-clock TTL sweep (see
    // `get()`'s lazy check above) and Set keys have no TTL semantics
    // this fake needs to reproduce for any current test — a no-op
    // "success" return is sufficient for `RefreshTokenStore.issue()`'s
    // fire-and-forget `expire()` call on the session index.
    return 1;
  }

  async eval(script: string, _numKeys: number, key: string, ...args: unknown[]): Promise<unknown> {
    if (
      script.includes("-- SCRIPT: pending-registration-claim-send") ||
      script.includes("-- SCRIPT: password-reset-claim-send")
    ) {
      const [cooldownSeconds, ttlSeconds, nowMs, newRecord] = args as [
        number,
        number,
        number,
        string,
      ];
      const entry = this.store.get(key);
      if (entry) {
        const decoded = JSON.parse(entry.value) as { lastOtpSentAtMs?: number };
        if (typeof decoded.lastOtpSentAtMs === "number") {
          const elapsedSeconds = (Number(nowMs) - decoded.lastOtpSentAtMs) / 1000;
          const remainingSeconds = Number(cooldownSeconds) - elapsedSeconds;
          if (remainingSeconds > 0) {
            return ["COOLDOWN", String(remainingSeconds)];
          }
        }
      }
      this.store.set(key, {
        value: newRecord,
        expiresAtMs: Date.now() + Number(ttlSeconds) * 1000,
      });
      return ["OK"];
    }

    if (
      script.includes("-- SCRIPT: pending-registration-record-failed-attempt") ||
      script.includes("-- SCRIPT: password-reset-record-failed-attempt")
    ) {
      const [maxAttempts, nowMs] = args as [number, number];
      const entry = this.store.get(key);
      if (!entry) {
        return ["NOT_FOUND"];
      }
      const decoded = JSON.parse(entry.value) as {
        otpAttempts: number;
        otpExpiresAtMs?: number;
      };
      if (typeof decoded.otpExpiresAtMs === "number" && decoded.otpExpiresAtMs < Number(nowMs)) {
        this.store.delete(key);
        return ["EXPIRED"];
      }
      if (decoded.otpAttempts >= Number(maxAttempts)) {
        this.store.delete(key);
        return ["MAX_ATTEMPTS_EXCEEDED"];
      }
      decoded.otpAttempts += 1;
      if (decoded.otpAttempts >= Number(maxAttempts)) {
        this.store.delete(key);
        return ["MAX_ATTEMPTS_EXCEEDED"];
      }
      // KEEPTTL semantics: preserve the existing expiresAtMs untouched.
      this.store.set(key, { value: JSON.stringify(decoded), expiresAtMs: entry.expiresAtMs });
      return ["INCREMENTED", String(Number(maxAttempts) - decoded.otpAttempts)];
    }

    if (script.includes("-- SCRIPT: refresh-token-consume")) {
      const entry = this.store.get(key);
      if (!entry) {
        return false;
      }
      this.store.delete(key);
      return entry.value;
    }

    throw new Error("InMemoryRedisClient.eval: unrecognized script");
  }
}

export class FakeRedisService {
  private readonly client = new InMemoryRedisClient();

  async onModuleInit(): Promise<void> {
    // no-op
  }

  onModuleDestroy(): void {
    // no-op
  }

  getClient(): Redis {
    return this.client as unknown as Redis;
  }
}
