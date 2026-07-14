import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { ENV } from "../config/config.constants";
import { RedisService } from "../redis/redis.service";
import { PasswordHasherService } from "./password-hasher.service";

const KEY_PREFIX = "auth:refresh-token:";
const SECRET_BYTES = 32;

export interface IssuedRefreshToken {
  /** Opaque bearer value handed to the client: `${tokenId}.${secret}`. */
  token: string;
  expiresInSeconds: number;
}

export type ConsumeRefreshTokenResult =
  | { status: "OK"; userId: string }
  | { status: "NOT_FOUND" };

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

  /** Issues a brand-new refresh token for `userId`, with a fresh `JWT_REFRESH_TTL_SECONDS` TTL. */
  async issue(userId: string): Promise<IssuedRefreshToken> {
    const tokenId = randomUUID();
    const secret = randomBytes(SECRET_BYTES).toString("base64url");
    const secretHash = await this.passwordHasher.hash(secret);

    await this.redis
      .getClient()
      .set(
        this.key(tokenId),
        JSON.stringify({ userId, secretHash }),
        "EX",
        this.env.JWT_REFRESH_TTL_SECONDS,
      );

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
    };

    const isValid = await this.passwordHasher.verify(secretHash, secret);
    if (!isValid) {
      return { status: "NOT_FOUND" };
    }

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
    await this.redis.getClient().del(this.key(parsed.tokenId));
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
