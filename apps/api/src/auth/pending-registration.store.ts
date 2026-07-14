import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { ENV } from "../config/config.constants";
import { RedisService } from "../redis/redis.service";

export interface PendingRegistrationRecord {
  name: string;
  passwordHash: string;
  otpHash: string;
  otpAttempts: number;
  /** ISO timestamp — when the *current* OTP code stops being acceptable. */
  otpExpiresAt: string;
  /** ISO timestamp — used to enforce the resend cooldown. */
  lastOtpSentAt: string;
}

/** Internal-only wire shape stored in Redis: adds epoch-ms mirrors of the
 * two ISO timestamps so the Lua scripts can do numeric comparisons
 * without parsing dates (Redis's embedded Lua has no date parser). */
interface StoredRecord extends PendingRegistrationRecord {
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

const KEY_PREFIX = "auth:pending-registration:";

/**
 * Atomically claims the right to (re)send an OTP for `email`, subject to
 * the resend cooldown.
 *
 * Read-modify-write here (GET cooldown check, then SET) is exactly the
 * race the Phase 2 Step 3 blocker fix closes: two concurrent
 * register/resend calls for the same email must not both observe
 * "cooldown elapsed" and both write a fresh OTP. This script performs the
 * cooldown check and the write as one atomic Redis operation, so only one
 * of any two racing callers can ever win the claim.
 *
 * KEYS[1] = the pending-registration key
 * ARGV[1] = cooldown window, in seconds
 * ARGV[2] = TTL to set on the new record, in seconds
 * ARGV[3] = "now", as epoch milliseconds
 * ARGV[4] = the new record, JSON-encoded (StoredRecord shape)
 *
 * Returns either {"OK"} or {"COOLDOWN", "<remaining-seconds>"}.
 */
const CLAIM_SEND_SCRIPT = `
-- SCRIPT: pending-registration-claim-send
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
 * Atomically records one failed OTP verification attempt for `email`.
 *
 * Read-modify-write here is the second race the Phase 2 Step 3 blocker
 * fix closes: two concurrent wrong-OTP attempts must not both read
 * `otpAttempts = N` and both write back `N + 1`, silently losing an
 * increment and letting `OTP_MAX_ATTEMPTS` be bypassed. This script does
 * the read, the expiry/limit checks, and the increment-or-delete as one
 * atomic Redis operation. It always writes with `KEEPTTL` (never a fresh
 * `EX`), so a wrong guess can never extend how long an attacker has to
 * keep guessing.
 *
 * KEYS[1] = the pending-registration key
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
-- SCRIPT: pending-registration-record-failed-attempt
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
 * Redis-backed storage for in-flight (not yet verified) registrations,
 * keyed by normalized email — per the approved Phase 2 decision that OTP
 * state lives in Redis, not Postgres.
 *
 * The Redis key's own TTL is the source of truth for "has this pending
 * registration fully expired" (set on every successful `claimSend`).
 * `otpExpiresAt` is a secondary, slightly-earlier-or-equal timestamp
 * checked by `recordFailedAttempt` (and by the service layer on read) so
 * an about-to-expire record can be rejected with a clear "expired" error
 * before it simply disappears from Redis.
 *
 * Every operation that reads current state and then decides what to
 * write (claiming a send against the cooldown, counting a failed
 * attempt) is implemented as a single Lua script (`EVAL`), which Redis
 * runs atomically — no other command can interleave between the read and
 * the write. Plain `get`/`delete` remain simple, non-atomic commands
 * since nothing security-sensitive is decided from their result alone.
 */
@Injectable()
export class PendingRegistrationStore {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}

  private key(email: string): string {
    return `${KEY_PREFIX}${email}`;
  }

  async get(email: string): Promise<PendingRegistrationRecord | null> {
    const raw = await this.redis.getClient().get(this.key(email));
    if (!raw) {
      return null;
    }
    const { otpExpiresAtMs: _otpExpiresAtMs, lastOtpSentAtMs: _lastOtpSentAtMs, ...record } =
      JSON.parse(raw) as StoredRecord;
    return record;
  }

  /**
   * Atomically claims the right to send a fresh OTP for `email`, subject
   * to the resend cooldown, and — only if the claim succeeds — writes
   * `record` with a fresh `OTP_TTL_SECONDS` TTL. Used for both a
   * brand-new registration and a resend; both start a new OTP lifecycle
   * and both must respect the cooldown against whatever is currently
   * stored (if anything).
   */
  async claimSend(email: string, record: PendingRegistrationRecord): Promise<ClaimSendResult> {
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
    throw new Error(`PendingRegistrationStore: unexpected claimSend result: ${String(raw)}`);
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
          `PendingRegistrationStore: unexpected recordFailedAttempt result: ${String(raw)}`,
        );
    }
  }
}
