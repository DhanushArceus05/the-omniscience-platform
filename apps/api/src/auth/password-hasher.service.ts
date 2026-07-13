import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

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
}
