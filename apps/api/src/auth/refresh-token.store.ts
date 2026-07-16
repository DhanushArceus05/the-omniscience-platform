import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { ENV } from "../config/config.constants";
import { RedisService } from "../redis/redis.service";
import { PasswordHasherService } from "./password-hasher.service";

const KEY_PREFIX = "auth:refresh-token:";
const INDEX_KEY_PREFIX = "auth:refresh-token-index:";
const SECRET_BYTES = 32;

export interface IssuedRefreshToken {
  /** Opaque bearer value handed to the client: `${tokenId}.${secret}`. */
  token: string;
  expiresInSeconds: number;
}

export type ConsumeRefreshTokenResult =
  | { status: "OK"; userId: string }
  | { status: "NOT_FOUND" };

/** Phase 2 Step 7 — one active session as surfaced by `listSessions`. */
export interface SessionSummary {
  tokenId: string;
  createdAt: string;
}

/**
 * Atomically consumes (reads-and-deletes in one step) a refresh-token
 * record.
 *
 * Read-then-delete here is the same class of race Phase 2 Step 3's
 * blocker fix closed for pending registrations: two concurrent
 * `/auth/refresh` calls presenting the same token must not both succeed
 * in rotating it — a refresh token is single-use, so only one caller may
 * ever observe the record. `GETDEL` (Redis >= 6.2) does exactly this: it
 * returns the value and deletes the key as one atomic command, so a
 * second, racing caller (or a replayed/stolen token) always sees
 * `nil` — no window exists where both callers could read the record
 * before either deletes it.
 *
 * KEYS[1] = the refresh-token key
 *
 * Returns the stored JSON, or `false` if the key didn't exist.
 */
const CONSUME_SCRIPT = `
-- SCRIPT: refresh-token-consume
local key = KEYS[1]
local value = redis.call('GETDEL', key)
if not value then
  return false
end
return value
`;

/**
 * Redis-backed storage for refresh tokens (Phase 2 Step 4), per the
 * approved Phase 2 decision that refresh tokens — like OTPs — live only
 * in Redis, never Postgres.
 *
 * A refresh token is deliberately NOT a JWT: unlike the stateless access
 * token, it must be revocable (logout) and single-use (rotation), both of
 * which require server-side state. The bearer value handed to the client
 * is `${tokenId}.${secret}` — `tokenId` is the Redis key suffix (a
 * `randomUUID()`, safe to use for O(1) lookup since it carries no
 * secrecy on its own), and `secret` is a separate high-entropy random
 * value whose Argon2id hash (via the existing `PasswordHasherService`,
 * reused rather than introducing a second hashing primitive — same
 * reasoning as OTP hashing in Step 3) is the only thing ever stored.
 * Even a full read of Redis's contents doesn't expose a usable token.
 *
 * Phase 2 Step 7 addition: each issued token's `tokenId` is also added to
 * a per-user Redis Set (`auth:refresh-token-index:{userId}`), purely so
 * `listSessions`/`revokeSession`/`revokeAllForUser` can enumerate a
 * user's own active sessions without an O(n) `SCAN` over every refresh
 * token in Redis. The index is best-effort bookkeeping only — it is
 * never consulted to decide whether a token is valid; the token's own
 * key (above) remains the sole source of truth for that, and every
 * index read re-checks the real key before treating a session as live
 * (see `listSessions`).
 */
@Injectable()
export class RefreshTokenStore {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  private key(tokenId: string): string {
    return `${KEY_PREFIX}${tokenId}`;
  }

  private indexKey(userId: string): string {
    return `${INDEX_KEY_PREFIX}${userId}`;
  }

  /** Issues a brand-new refresh token for `userId`, with a fresh `JWT_REFRESH_TTL_SECONDS` TTL. */
  async issue(userId: string): Promise<IssuedRefreshToken> {
    const tokenId = randomUUID();
    const secret = randomBytes(SECRET_BYTES).toString("base64url");
    const secretHash = await this.passwordHasher.hash(secret);
    const createdAt = new Date().toISOString();

    const client = this.redis.getClient();
    await client.set(
      this.key(tokenId),
      JSON.stringify({ userId, secretHash, createdAt }),
      "EX",
      this.env.JWT_REFRESH_TTL_SECONDS,
    );
    // Step 7 session index — see class docstring. The index Set's own
    // TTL is refreshed to the same window on every issue; a slightly
    // longer-lived index than any individual token it references is
    // harmless, since `listSessions` prunes entries whose real token key
    // has already expired.
    await client.sadd(this.indexKey(userId), tokenId);
    await client.expire(this.indexKey(userId), this.env.JWT_REFRESH_TTL_SECONDS);

    return {
      token: `${tokenId}.${secret}`,
      expiresInSeconds: this.env.JWT_REFRESH_TTL_SECONDS,
    };
  }

  /**
   * Atomically consumes `token` — it can never be presented again after
   * this call, whether it succeeds or fails. Returns the `userId` it was
   * issued for on success, or `NOT_FOUND` for a token that's unknown,
   * already used, expired, or malformed. Verifying the token's secret
   * against its stored hash happens in Node (Argon2 isn't available
   * inside Redis's embedded Lua) after the atomic `GETDEL`, so a wrong
   * secret for a real `tokenId` still permanently burns that record —
   * never a second guess against the same one.
   */
  async consume(token: string): Promise<ConsumeRefreshTokenResult> {
    const parsed = this.parseToken(token);
    if (!parsed) {
      return { status: "NOT_FOUND" };
    }
    const { tokenId, secret } = parsed;

    const raw = await this.redis.getClient().eval(CONSUME_SCRIPT, 1, this.key(tokenId));
    if (raw === false || raw === null) {
      return { status: "NOT_FOUND" };
    }

    const { userId, secretHash } = JSON.parse(raw as string) as {
      userId: string;
      secretHash: string;
      createdAt?: string;
    };

    const isValid = await this.passwordHasher.verify(secretHash, secret);
    if (!isValid) {
      return { status: "NOT_FOUND" };
    }

    // Step 7 session index — see class docstring. Best-effort cleanup
    // only; consume()'s own validity decision above is already final.
    await this.redis.getClient().srem(this.indexKey(userId), tokenId);

    return { status: "OK", userId };
  }

  /**
   * Revokes `token` (logout) so it can never be used again. Idempotent —
   * revoking an already-consumed, already-revoked, expired, or unknown
   * token is a no-op, not an error, since the caller's goal ("this token
   * must not work anymore") is already satisfied either way.
   */
  async revoke(token: string): Promise<void> {
    const parsed = this.parseToken(token);
    if (!parsed) {
      return;
    }
    const client = this.redis.getClient();
    // Read first (not atomically paired with the delete below — a
    // logout racing a concurrent refresh for the exact same token is
    // already an inherently ambiguous case the caller controls by not
    // reusing a token it's about to revoke) purely to learn which
    // user's session index to prune; the delete itself is what actually
    // revokes the token; a missed/duplicate index prune here can never
    // make a revoked token usable again.
    const raw = await client.get(this.key(parsed.tokenId));
    await client.del(this.key(parsed.tokenId));
    if (raw) {
      const { userId } = JSON.parse(raw) as { userId: string };
      await client.srem(this.indexKey(userId), parsed.tokenId);
    }
  }

  /**
   * Phase 2 Step 7 — lists `userId`'s active sessions (one per
   * outstanding refresh token), newest first. Reads the per-user index
   * Set, then re-checks each `tokenId`'s real token key so a session
   * that already expired naturally (or was revoked through a path that
   * predates this index) is never reported as active; any such stale
   * entry is pruned from the index as it's found.
   */
  async listSessions(userId: string): Promise<SessionSummary[]> {
    const client = this.redis.getClient();
    const tokenIds = await client.smembers(this.indexKey(userId));

    const sessions: SessionSummary[] = [];
    for (const tokenId of tokenIds) {
      const raw = await client.get(this.key(tokenId));
      if (!raw) {
        await client.srem(this.indexKey(userId), tokenId);
        continue;
      }
      const { createdAt } = JSON.parse(raw) as { createdAt?: string };
      sessions.push({ tokenId, createdAt: createdAt ?? new Date(0).toISOString() });
    }

    return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Phase 2 Step 7 — revokes exactly one of `userId`'s own sessions by
   * `tokenId`. Membership in `userId`'s own index is checked first, so
   * this can never be used to revoke a *different* user's session by
   * guessing/enumerating `tokenId` values — the caller only ever learns
   * "not found" for a `tokenId` that isn't theirs, identical to one that
   * never existed. Returns `true` only if a real, still-live token was
   * deleted.
   */
  async revokeSession(userId: string, tokenId: string): Promise<boolean> {
    const client = this.redis.getClient();
    const isMember = await client.sismember(this.indexKey(userId), tokenId);
    if (!isMember) {
      return false;
    }
    const deletedCount = await client.del(this.key(tokenId));
    await client.srem(this.indexKey(userId), tokenId);
    return deletedCount > 0;
  }

  /**
   * Phase 2 Step 7 — revokes every active session for `userId` ("log out
   * everywhere"). Returns the number of sessions actually revoked.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const client = this.redis.getClient();
    const tokenIds = await client.smembers(this.indexKey(userId));
    if (tokenIds.length === 0) {
      return 0;
    }
    await client.del(...tokenIds.map((tokenId) => this.key(tokenId)));
    await client.del(this.indexKey(userId));
    return tokenIds.length;
  }

  private parseToken(token: string): { tokenId: string; secret: string } | null {
    const separatorIndex = token.indexOf(".");
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
      return null;
    }
    return {
      tokenId: token.slice(0, separatorIndex),
      secret: token.slice(separatorIndex + 1),
    };
  }
}
