import { BadRequestException, Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

/**
 * Shared error code/message for "the new password is identical to the
 * one already on the account" — used by both the OTP-gated reset flow
 * (`AuthService.resetPassword`) and the authenticated change-password
 * flow (`UsersService.changePassword`) so callers don't invent two
 * names for the same failure.
 */
export const NEW_PASSWORD_MUST_DIFFER_ERROR = {
  code: "NEW_PASSWORD_MUST_DIFFER",
  message: "New password must be different from your current password.",
} as const;

/**
 * Focused Argon2id password hashing abstraction. This is the only place
 * in the codebase that should call the `argon2` package directly, so
 * hashing parameters are tuned in one spot rather than scattered.
 *
 * Never logs a plaintext password or a resulting hash — callers must
 * follow the same rule wherever they handle a raw password.
 */
@Injectable()
export class PasswordHasherService {
  // OWASP-recommended minimums for argon2id (as of current guidance):
  // >=19 MiB memory, >=2 iterations, >=1 degree of parallelism. Set
  // slightly above the floor for headroom; revisit here (not per-caller)
  // if hardware/latency budgets change.
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 3,
    parallelism: 1,
  };

  /**
   * Hashes a plaintext password. The returned string is a self-contained
   * PHC-format hash (algorithm, params, salt, and digest all encoded
   * together), so `verify` doesn't need the original options repeated.
   */
  async hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  /**
   * Verifies a plaintext password against a previously stored hash.
   * Returns `false` for a wrong password, an empty/malformed hash, or a
   * hash produced by an incompatible algorithm/version — argon2's own
   * `verify` throws on some of those cases rather than returning false,
   * so this normalizes all of them to a single boolean contract instead
   * of leaking a raw crypto error to callers.
   */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /**
   * Rejects a candidate new password that is identical to the
   * account's current one. Shared by `AuthService.resetPassword`
   * (Step 5, OTP-gated) and `UsersService.changePassword` (Step 6,
   * authenticated) — both must apply this rule, and both throw the
   * same `NEW_PASSWORD_MUST_DIFFER_ERROR` shape so clients only ever
   * handle one code for this failure regardless of which flow they
   * called. Runs the same `verify` used for real credential checks
   * (not a plaintext compare), so it stays constant-time and
   * consistent with the hash actually stored.
   */
  async assertDiffersFromCurrent(currentHash: string, newPassword: string): Promise<void> {
    const isSameAsCurrent = await this.verify(currentHash, newPassword);
    if (isSameAsCurrent) {
      throw new BadRequestException(NEW_PASSWORD_MUST_DIFFER_ERROR);
    }
  }
}
