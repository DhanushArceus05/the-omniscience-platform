import type { OmniCoreDomainErrorCode } from "./omnicore.errors";
import { omniCoreDomainError } from "./omnicore.errors";

/**
 * Options controlling a single racing execution — a step's model call
 * (`StepExecutorService`, Phase 5 Step 4) or a tool call
 * (`ToolExecutorService`, Phase 5 Step 5). Both are optional — omitting
 * either runs with no time budget and no way to cancel it, exactly
 * like a direct, un-raced call would.
 */
export interface RaceOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Which two domain codes {@link raceAgainstTimeoutAndCancellation} and
 * {@link assertNotAborted} should throw for a given caller.
 * `StepExecutorService` passes `EXECUTION_TIMEOUT`/`EXECUTION_CANCELLED`;
 * `ToolExecutorService` passes `TOOL_TIMEOUT`/`TOOL_CANCELLED` — same
 * race logic, deliberately distinct vocabularies (see
 * `omnicore.errors.ts`'s doc comment for why they're kept separate).
 */
export interface RaceErrorCodes {
  readonly timeoutCode: OmniCoreDomainErrorCode;
  readonly cancelledCode: OmniCoreDomainErrorCode;
}

/**
 * Extracted from `StepExecutorService` in Phase 5 Step 5 so
 * `ToolExecutorService` could reuse the exact same timeout/
 * cancellation logic (requirement 3: "reuse Step 4 execution
 * architecture") rather than re-implementing it — the only thing that
 * differs between the two callers is which domain codes get thrown,
 * which is why that's a parameter rather than hardcoded here.
 */
export function assertNotAborted(signal: AbortSignal | undefined, cancelledCode: OmniCoreDomainErrorCode, message: string): void {
  if (signal?.aborted) {
    throw omniCoreDomainError(cancelledCode, message);
  }
}

/**
 * Races `promise` against an optional timeout and an optional
 * cancellation signal, without touching `promise` itself — if neither
 * is configured, `promise` is returned untouched so this function adds
 * no overhead to the common case. Whichever settles first wins; a
 * timeout throws `codes.timeoutCode`, an abort throws
 * `codes.cancelledCode`, and either listener is always cleaned up so a
 * call that finishes first never leaves a dangling timer or listener
 * behind.
 */
export function raceAgainstTimeoutAndCancellation<T>(
  promise: Promise<T>,
  options: RaceOptions,
  codes: RaceErrorCodes,
): Promise<T> {
  if (options.timeoutMs === undefined && !options.signal) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(omniCoreDomainError(codes.timeoutCode, `Execution exceeded its ${options.timeoutMs}ms timeout.`));
          }, options.timeoutMs)
        : undefined;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(omniCoreDomainError(codes.cancelledCode, "Execution was cancelled while running."));
    };

    options.signal?.addEventListener("abort", onAbort);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}
