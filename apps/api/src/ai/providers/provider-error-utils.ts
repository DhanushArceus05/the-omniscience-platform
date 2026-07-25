/**
 * Structural (duck-typed) error-detection helpers shared by every real
 * `OmniProvider` adapter's error mapper (Phase 4 Step 5 production
 * hardening).
 *
 * Extracted from `gemini-error-mapper.ts` (Phase 4 Step 4's
 * post-verification fixes) once `anthropic-error-mapper.ts` needed the
 * exact same defense-in-depth capability, to avoid two independent,
 * silently-diverging copies of logic this important. Both mappers'
 * *primary* classification path is unchanged by this extraction —
 * Anthropic still branches on `instanceof` against
 * `@anthropic-ai/sdk`'s own typed error classes first, and Gemini still
 * reads `@google/genai`'s `ApiError.status` directly; these helpers are
 * only ever consulted as a fallback, after a mapper's own SDK-specific
 * checks have all failed to match.
 *
 * ## Why this exists at all
 *
 * A real local run showed an invalid `GEMINI_API_KEY` producing an
 * error that did not satisfy `error instanceof ApiError` — it fell
 * through to a generic, unhelpful classification instead of
 * `PROVIDER_AUTH_FAILED`. Nominal `instanceof` checks against a
 * third-party SDK's exception class are fragile for reasons entirely
 * outside this codebase's control:
 * - An SDK's own retry/HTTP layer can rethrow the *original* error
 *   wrapped inside a different class (its own `PermanentError`/
 *   `TemporaryError`-style wrapper, exposing the original via `.cause`)
 *   once it decides a failure is non-retryable — the caller then sees
 *   the wrapper, not the thing that has the useful `status` on it.
 * - A monorepo's package manager can hoist/dedupe a dependency such
 *   that two structurally-identical classes end up as two distinct
 *   runtime identities — `instanceof` is a strict prototype-chain
 *   check, so this can silently fail even though every field the code
 *   actually cares about is present and correctly shaped.
 *
 * Neither failure mode changes what actually matters for
 * classification: *some* object in the error's own shape or its
 * `.cause` chain usually still has a numeric HTTP-like `status`. So
 * `extractStatusInfo()` reads `.status` directly off the thrown value,
 * and — if that's absent — off up to a few levels of `.cause`,
 * regardless of which concrete class produced it.
 */

export interface StatusInfo {
  readonly status: number;
  readonly message: string | undefined;
}

/**
 * The traversal depth is capped purely as a defensive bound against a
 * pathological/cyclic `.cause` chain — real error-wrapping chains are
 * one or two levels deep at most.
 */
const MAX_CAUSE_DEPTH = 5;

/**
 * Structurally (duck-typed) looks for a numeric HTTP-like `status` on
 * `error` itself, and — if absent — on up to a few levels of `.cause`.
 * Never assumes a particular class or prototype chain; only ever reads
 * plain own-property shape, so it works equally whether `error` is a
 * genuine SDK error instance, an SDK-internal wrapper exposing the real
 * error via `.cause`, a structurally-equivalent instance from a
 * duplicated copy of the same package, or a hand-built test fixture
 * shaped like any of the above.
 *
 * `fallbackFromMessage`, if given, is consulted only once the structural
 * `.status`/`.cause` search above has been fully exhausted — it lets an
 * individual mapper recover a status from a vendor- or SDK-specific
 * message shape that carries no `.status` property at all (see
 * `gemini-error-mapper.ts`'s `p-retry`-wrapped-message fallback for a
 * concrete example). Deliberately opt-in per mapper rather than baked
 * in here, since a message-parsing heuristic is inherently specific to
 * one SDK's exact wording and must not silently apply to another
 * provider's errors.
 */
export function extractStatusInfo(
  error: unknown,
  options?: { readonly fallbackFromMessage?: (message: string) => number | undefined },
  depth = 0,
): StatusInfo | undefined {
  if (depth > MAX_CAUSE_DEPTH || error === null || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as { status?: unknown; message?: unknown; cause?: unknown };

  if (typeof candidate.status === "number") {
    return {
      status: candidate.status,
      message: typeof candidate.message === "string" ? candidate.message : undefined,
    };
  }

  if ("cause" in candidate && candidate.cause !== undefined && candidate.cause !== error) {
    return extractStatusInfo(candidate.cause, options, depth + 1);
  }

  if (options?.fallbackFromMessage !== undefined && typeof candidate.message === "string") {
    const recovered = options.fallbackFromMessage(candidate.message);
    if (recovered !== undefined) {
      return { status: recovered, message: undefined };
    }
  }

  return undefined;
}

/**
 * A request timeout (wired via `AbortSignal.timeout()` in both
 * `@anthropic-ai/sdk` and `@google/genai`) surfaces as a standard DOM
 * `AbortError`/`TimeoutError`, not as anything with an HTTP `status` —
 * no response was ever received. Checked by `name` rather than
 * `instanceof DOMException` so this also matches an equivalent plain
 * `Error` in environments/mocks that don't throw a real `DOMException`.
 * Callers should check this only *after* `extractStatusInfo()` finds
 * nothing, so a genuine HTTP-level error is never miscategorized as a
 * timeout merely because its `name` happens to collide.
 */
export function isTimeoutErrorByName(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * A short, non-secret structural fingerprint of an unrecognized error —
 * its `name`/constructor name and whether it carries a `.cause` — safe
 * to log at `warn` when a mapper's final "nothing matched" fallback is
 * reached, so a *future* unrecognized shape (for any provider) is
 * visible in logs immediately rather than silently degrading to a
 * generic response indefinitely. Never includes `.message` or any other
 * field that could carry request content, response bodies, or
 * credentials.
 */
export function describeUnrecognizedError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorConstructor: error.constructor?.name,
      hasCause: "cause" in error && (error as { cause?: unknown }).cause !== undefined,
    };
  }
  return { errorType: typeof error };
}
