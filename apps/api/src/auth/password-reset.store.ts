import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { ENV } from "../config/config.constants";
import { RedisService } from "../redis/redis.service";

export interface PasswordResetRecord {
  userId: string;
  otpHash: string;
  otpAttempts: number;
  /** ISO timestamp — when the *current* OTP code stops being acceptable. */
  otpExpiresAt: string;
  /** ISO timestamp — used to enforce the resend cooldown. */
  lastOtpSentAt: string;
}

/** Internal-only wire shape stored in Redis: adds epoch-ms mirrors of the
 * two ISO timestamps so the Lua scripts can do numeric comparisons
 * without parsing dates (Redis's embedded Lua has no date parser). Same
 * approach as `PendingRegistrationStore` (Step 3). */
interface StoredRecord extends PasswordResetRecord {
  otpExpiresAtMs: number;
  lastOtpSentAtMs: number;
}

export type ClaimSendResult =
  | { status: "OK" }
  | { status: "COOLDOWN"; retryAfterSeconds: number };

export type RecordFailedAttemptResult =
  | { status: "NOT_FOUND" }
  | { status: "EXPIRED" }
  | { status: "MAX_ATTEMPTS_EXCEEDED" }
  | { status: "INCREMENTED"; attemptsRemaining: number };

const KEY_PREFIX = "auth:password-reset:";

/**
 * Atomically claims the right to (re)send a password-reset OTP for
 * `email`, subject to the resend cooldown. Identical shape and race
 * closed as `PendingRegistrationStore`'s `CLAIM_SEND_SCRIPT` (Phase 2
 * Step 3): two concurrent `/auth/forgot-password` calls for the same
 * email must not both observe "cooldown elapsed" and both send an OTP
 * email.
 *
 * KEYS[1] = the password-reset key
 * ARGV[1] = cooldown window, in seconds
 * ARGV[2] = TTL to set on the new record, in seconds
 * ARGV[3] = "now", as epoch milliseconds
 * ARGV[4] = the new record, JSON-encoded (StoredRecord shape)
 *
 * Returns either {"OK"} or {"COOLDOWN", "<remaining-seconds>"}.
 */
const CLAIM_SEND_SCRIPT = `
-- SCRIPT: password-reset-claim-send
local key = KEYS[1]
local cooldownSeconds = tonumber(ARGV[1])
local ttlSeconds = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local newRecord = ARGV[4]

local current = redis.call('GET', key)
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and decoded.lastOtpSentAtMs then
    local elapsedSeconds = (nowMs - decoded.lastOtpSentAtMs) / 1000
    local remainingSeconds = cooldownSeconds - elapsedSeconds
    if remainingSeconds > 0 then
      return {"COOLDOWN", tostring(remainingSeconds)}
    end
  end
end

redis.call('SET', key, newRecord, 'EX', ttlSeconds)
return {"OK"}
`;

/**
 * Atomically records one failed OTP verification attempt for `email`'s
 * password-reset record. Identical shape and race closed as
 * `PendingRegistrationStore`'s `RECORD_FAILED_ATTEMPT_SCRIPT` (Phase 2
 * Step 3).
 *
 * KEYS[1] = the password-reset key
 * ARGV[1] = OTP_MAX_ATTEMPTS
 * ARGV[2] = "now", as epoch milliseconds
 *
 * Returns one of:
 *   {"NOT_FOUND"}
 *   {"EXPIRED"}                                  (key is deleted)
 *   {"MAX_ATTEMPTS_EXCEEDED"}                     (key is deleted)
 *   {"INCREMENTED", "<attempts-remaining>"}
 */
const RECORD_FAILED_ATTEMPT_SCRIPT = `
-- SCRIPT: password-reset-record-failed-attempt
local key = KEYS[1]
local maxAttempts = tonumber(ARGV[1])
local nowMs = tonumber(ARGV[2])

local current = redis.call('GET', key)
if not current then
  return {"NOT_FOUND"}
end

local ok, decoded = pcall(cjson.decode, current)
if not ok then
  return {"NOT_FOUND"}
end

if decoded.otpExpiresAtMs and decoded.otpExpiresAtMs < nowMs then
  redis.call('DEL', key)
  return {"EXPIRED"}
end

if decoded.otpAttempts >= maxAttempts then
  redis.call('DEL', key)
  return {"MAX_ATTEMPTS_EXCEEDED"}
end

decoded.otpAttempts = decoded.otpAttempts + 1

if decoded.otpAttempts >= maxAttempts then
  redis.call('DEL', key)
  return {"MAX_ATTEMPTS_EXCEEDED"}
end

redis.call('SET', key, cjson.encode(decoded), 'KEEPTTL')
return {"INCREMENTED", tostring(maxAttempts - decoded.otpAttempts)}
`;

/**
 * Redis-backed storage for in-flight password-reset OTPs (Phase 2 Step
 * 5), keyed by normalized email — same approved Phase 2 decision as
 * `PendingRegistrationStore` (Step 3) and `RefreshTokenStore` (Step 4)
 * that ephemeral auth state lives in Redis, not Postgres.
 *
 * Deliberately its own store rather than reusing
 * `PendingRegistrationStore`: the two hold structurally different
 * records (`userId` vs. a not-yet-created account's `name`/
 * `passwordHash`) and are keyed under a different namespace so a
 * forgot-password flow can never collide with, read, or be confused with
 * an in-flight registration for the same email address.
 *
 * As with `PendingRegistrationStore`, every operation that reads current
 * state and then decides what to write (claiming a send against the
 * cooldown, counting a failed attempt) is a single atomic Lua script
 * (`EVAL`); plain `get`/`delete` remain simple, non-atomic commands since
 * nothing security-sensitive is decided from their result alone.
 */
@Injectable()
export class PasswordResetStore {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}

  private key(email: string): string {
    return `${KEY_PREFIX}${email}`;
  }

  async get(email: string): Promise<PasswordResetRecord | null> {
    const raw = await this.redis.getClient().get(this.key(email));
    if (!raw) {
      return null;
    }
    const { otpExpiresAtMs: _otpExpiresAtMs, lastOtpSentAtMs: _lastOtpSentAtMs, ...record } =
      JSON.parse(raw) as StoredRecord;
    return record;
  }

  /**
   * Atomically claims the right to send a fresh password-reset OTP for
   * `email`, subject to the resend cooldown, and — only if the claim
   * succeeds — writes `record` with a fresh `OTP_TTL_SECONDS` TTL. Used
   * for every `/auth/forgot-password` call for an email that has a real
   * account; each call starts a new OTP lifecycle and must respect the
   * cooldown against whatever is currently stored (if anything).
   */
  async claimSend(email: string, record: PasswordResetRecord): Promise<ClaimSendResult> {
    const now = Date.now();
    const stored: StoredRecord = {
      ...record,
      otpExpiresAtMs: new Date(record.otpExpiresAt).getTime(),
      lastOtpSentAtMs: new Date(record.lastOtpSentAt).getTime(),
    };

    const raw = await this.redis
      .getClient()
      .eval(
        CLAIM_SEND_SCRIPT,
        1,
        this.key(email),
        this.env.OTP_RESEND_COOLDOWN_SECONDS,
        this.env.OTP_TTL_SECONDS,
        now,
        JSON.stringify(stored),
      );

    return this.parseClaimSendResult(raw);
  }

  /**
   * Atomically records one failed OTP verification attempt, enforcing
   * `OTP_MAX_ATTEMPTS` and the expiry check, and preserving the record's
   * remaining TTL exactly (never extending it).
   */
  async recordFailedAttempt(email: string): Promise<RecordFailedAttemptResult> {
    const raw = await this.redis
      .getClient()
      .eval(
        RECORD_FAILED_ATTEMPT_SCRIPT,
        1,
        this.key(email),
        this.env.OTP_MAX_ATTEMPTS,
        Date.now(),
      );

    return this.parseRecordFailedAttemptResult(raw);
  }

  async delete(email: string): Promise<void> {
    await this.redis.getClient().del(this.key(email));
  }

  private parseClaimSendResult(raw: unknown): ClaimSendResult {
    const parts = raw as [string, string?];
    const [status, arg] = parts;
    if (status === "OK") {
      return { status: "OK" };
    }
    if (status === "COOLDOWN") {
      return { status: "COOLDOWN", retryAfterSeconds: Math.ceil(Number(arg)) };
    }
    throw new Error(`PasswordResetStore: unexpected claimSend result: ${String(raw)}`);
  }

  private parseRecordFailedAttemptResult(raw: unknown): RecordFailedAttemptResult {
    const parts = raw as [string, string?];
    const [status, arg] = parts;
    switch (status) {
      case "NOT_FOUND":
        return { status: "NOT_FOUND" };
      case "EXPIRED":
        return { status: "EXPIRED" };
      case "MAX_ATTEMPTS_EXCEEDED":
        return { status: "MAX_ATTEMPTS_EXCEEDED" };
      case "INCREMENTED":
        return { status: "INCREMENTED", attemptsRemaining: Number(arg) };
      default:
        throw new Error(
          `PasswordResetStore: unexpected recordFailedAttempt result: ${String(raw)}`,
        );
    }
  }
}
