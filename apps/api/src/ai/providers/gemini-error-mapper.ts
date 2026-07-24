import type { HttpException } from "@nestjs/common";
import type { ModelId, ProviderId } from "@omniscience/types";
import { aiDomainError } from "../ai-provider.interface";

/**
 * Normalizes every failure `GeminiProvider.generateText` can encounter
 * into exactly one of this module's existing `AiDomainErrorCode`s, via
 * the shared `aiDomainError()` builder — the same convention
 * `anthropic-error-mapper.ts` already established. This is the only
 * place `@google/genai` error shapes are inspected anywhere in the `ai`
 * module; every caller of `GeminiProvider` sees only the normalized
 * `HttpException`.
 *
 * ## Why this does NOT use `error instanceof ApiError`
 *
 * An earlier version of this mapper branched on
 * `error instanceof @google/genai`'s exported `ApiError` class. A real
 * local run surfaced credentials `GEMINI_API_KEY` couldn't authenticate
 * with, and the thrown value did *not* satisfy that `instanceof` check
 * — it fell all the way through to the generic `PROVIDER_UNAVAILABLE`
 * bucket instead of `PROVIDER_AUTH_FAILED`. Nominal `instanceof` checks
 * against a third-party SDK's exception class are fragile in exactly
 * this way for reasons entirely outside this codebase's control:
 * - The SDK's own retry/HTTP layer can rethrow the *original* error
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
 * `.cause` chain has a numeric HTTP-like `status`. So this mapper does
 * structural (duck-typed) detection instead — `extractStatusInfo()`
 * below reads `.status` directly off the thrown value, and if that's
 * absent, off up to a few levels of `.cause`, regardless of which
 * concrete class produced it. This is strictly more robust than the
 * nominal check it replaces and covers the nominal case too (a real
 * `ApiError` instance has an own `status` property, so it's found on
 * the very first, zero-`cause`-traversal check).
 *
 * ## Defense-in-depth: the `p-retry`-wrapped shape, if it's ever seen again
 *
 * `gemini-client.provider.ts` no longer configures `httpOptions.retryOptions`
 * specifically so the real, structured `ApiError` (with a genuine
 * `.status` and the parsed response body) is always what reaches this
 * function — see that file's doc comment for the full trace of why. As
 * a second line of defense (not the primary path), this module also
 * recognizes the *exact* lossy message shapes that SDK's own bundled
 * `p-retry` dependency produces when `retryOptions` **is** configured
 * (`"Non-retryable exception <reason phrase> sending request"` /
 * `"Retryable HTTP Error: <reason phrase>"`) and recovers a numeric
 * status from the standard HTTP reason phrase embedded in them —
 * confirmed against the actual installed `@google/genai@2.13.0` and
 * `p-retry@4.6.2` source, not reconstructed from assumption. This never
 * recovers the real response body (that information is gone by the
 * time `p-retry` unwraps its `AbortError`), so it cannot feed the
 * 400-as-auth-message heuristic below — it only restores a bare status
 * code, which is still enough to avoid the `PROVIDER_UNAVAILABLE`
 * catch-all for a 401/403/429/5xx.
 *
 * ## Why 400 alone isn't always `PROVIDER_REQUEST_INVALID`
 *
 * Google's own generative-language backend does not reliably use
 * 401/403 for an invalid API key the way Anthropic's does — an invalid
 * key commonly comes back as a **400** whose body message reads
 * something like "API key not valid. Please pass a valid API key."
 * A bare `status === 400` branch would misclassify that as
 * `PROVIDER_REQUEST_INVALID` (a caller-fixable request shape problem)
 * rather than `PROVIDER_AUTH_FAILED` (a credential problem) — so a 400
 * is only treated as a bad *request* once its message has been checked,
 * internally only, against `AUTH_FAILURE_MESSAGE_PATTERN`. The message
 * itself is still never included in the response either way — this
 * check exists purely to pick the right bucket, not to surface content.
 *
 * Never includes the SDK error's own `message` (which can echo back
 * request content) in the thrown message — only a fixed, generic
 * description per category and, where meaningful, which provider/model
 * was involved. This satisfies the requirement that API keys, raw
 * vendor error bodies, and other vendor-internal details never reach a
 * caller, even indirectly through an error message.
 *
 * Unlike Anthropic's client, `gemini-client.provider.ts` deliberately
 * does not configure `httpOptions.retryOptions` at all (see that file's
 * doc comment) — so there is no SDK-level retry loop for Gemini to
 * exhaust before an error reaches this function; every call either
 * succeeds on the first attempt or this function classifies the first
 * failure it sees. An external, response-status-aware retry loop
 * remains a deferred item (see `claude/CURRENT_PHASE.md`).
 */
export function mapGeminiError(
  error: unknown,
  context: { readonly providerId: ProviderId; readonly modelId: ModelId },
): HttpException {
  const { providerId, modelId } = context;

  const statusInfo = extractStatusInfo(error);
  if (statusInfo !== undefined) {
    const { status, message } = statusInfo;

    if (status === 401 || status === 403) {
      return aiDomainError(
        "PROVIDER_AUTH_FAILED",
        `Provider "${providerId}" rejected its configured credentials.`,
      );
    }

    if (status === 429) {
      return aiDomainError(
        "PROVIDER_RATE_LIMITED",
        `Provider "${providerId}" is rate-limiting requests right now.`,
      );
    }

    if (status === 400) {
      // See the "Why 400 alone isn't always PROVIDER_REQUEST_INVALID"
      // section of the class doc comment above.
      if (message !== undefined && AUTH_FAILURE_MESSAGE_PATTERN.test(message)) {
        return aiDomainError(
          "PROVIDER_AUTH_FAILED",
          `Provider "${providerId}" rejected its configured credentials.`,
        );
      }

      return aiDomainError(
        "PROVIDER_REQUEST_INVALID",
        `Provider "${providerId}" rejected the request for model "${modelId}" as invalid.`,
      );
    }

    if (status >= 500) {
      return aiDomainError(
        "PROVIDER_UNAVAILABLE",
        `Provider "${providerId}" is currently unavailable (upstream error).`,
      );
    }

    // Any other HTTP-like status this module doesn't special-case
    // (e.g. a 404 for a deprecated/renamed model id) — still never
    // surfaced as a raw vendor error; treated as the provider being
    // unusable right now, same fallback bucket Anthropic's mapper uses
    // for its own uncategorized `APIError`s.
    return aiDomainError(
      "PROVIDER_UNAVAILABLE",
      `Provider "${providerId}" returned an unexpected error for model "${modelId}".`,
    );
  }

  if (isTimeoutError(error)) {
    return aiDomainError(
      "PROVIDER_TIMEOUT",
      `Provider "${providerId}" timed out generating text for model "${modelId}".`,
    );
  }

  // Not a recognized error shape at all — no numeric status anywhere
  // in the error or its `.cause` chain, and not a timeout (a network-
  // level failure, a bug, an unexpected throw, etc.). Still normalized,
  // still no internal detail leaked.
  return aiDomainError(
    "PROVIDER_UNAVAILABLE",
    `Provider "${providerId}" failed unexpectedly while generating text for model "${modelId}".`,
  );
}

/**
 * Matches the message text Google's backend actually sends for an
 * invalid/misconfigured API key (commonly under a 400, sometimes 401/
 * 403 depending on which failure mode was hit) — e.g. "API key not
 * valid. Please pass a valid API key.", or a machine-readable
 * `API_KEY_INVALID` reason code. Deliberately loose (case-insensitive,
 * tolerant of "api-key"/"api_key"/"API key" and "invalid"/"not valid")
 * since the exact wording is vendor-controlled and not a contract this
 * codebase can rely on staying byte-for-byte stable.
 */
const AUTH_FAILURE_MESSAGE_PATTERN =
  /api[_ -]?key.{0,60}?(not valid|invalid)|invalid.{0,10}api[_ -]?key|api_key_invalid|unauthenticated/i;

interface StatusInfo {
  readonly status: number;
  readonly message: string | undefined;
}

/**
 * Structurally (duck-typed) looks for a numeric HTTP-like `status` on
 * `error` itself, and — if absent — on up to a few levels of `.cause`.
 * Never assumes a particular class or prototype chain; only ever reads
 * plain own-property shape, so it works equally whether `error` is a
 * genuine `@google/genai` `ApiError`, an SDK-internal wrapper exposing
 * the real error via `.cause`, a structurally-equivalent instance from
 * a duplicated copy of the same package, or a hand-built test fixture
 * shaped like any of the above. See the "Why this does NOT use
 * `error instanceof ApiError`" section of this module's doc comment for
 * the reasoning.
 *
 * The traversal depth is capped (`MAX_CAUSE_DEPTH`) purely as a
 * defensive bound against a pathological/cyclic `.cause` chain — real
 * error-wrapping chains are one or two levels deep at most.
 */
const MAX_CAUSE_DEPTH = 5;

function extractStatusInfo(error: unknown, depth = 0): StatusInfo | undefined {
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
    return extractStatusInfo(candidate.cause, depth + 1);
  }

  // Last resort: no numeric `.status` anywhere in the shape or its
  // `.cause` chain — see the "Defense-in-depth" section of this
  // module's doc comment. Only attempted once we've exhausted the
  // structural checks above, and only ever recovers a bare status code
  // (never the real response body), so it can't feed the
  // 400-as-auth-message heuristic.
  if (typeof candidate.message === "string") {
    const recovered = extractStatusFromRetryWrapperMessage(candidate.message);
    if (recovered !== undefined) {
      return { status: recovered, message: undefined };
    }
  }

  return undefined;
}

/**
 * Matches the two exact message templates the `p-retry` package (a
 * dependency of `@google/genai`) produces when it unwraps its own
 * `AbortError`/exhausts its retries — confirmed against the installed
 * `p-retry@4.6.2` and `@google/genai@2.13.0` source:
 * `"Non-retryable exception <reason phrase> sending request"` and
 * `"Retryable HTTP Error: <reason phrase>"`. `<reason phrase>` is
 * `fetch`'s own `Response.statusText`, which for a standards-compliant
 * HTTP server is one of the fixed strings in `REASON_PHRASE_TO_STATUS`
 * below — so this reverses that mapping back to a numeric status.
 * Returns `undefined` for anything that doesn't match one of these two
 * exact shapes, or whose reason phrase isn't one this module recognizes
 * (rather than guessing).
 */
function extractStatusFromRetryWrapperMessage(message: string): number | undefined {
  const match = /^(?:non-retryable exception (.+) sending request|retryable http error: (.+))$/i.exec(
    message,
  );
  if (match === null) {
    return undefined;
  }

  const reasonPhrase = (match[1] ?? match[2] ?? "").trim().toLowerCase();
  return REASON_PHRASE_TO_STATUS[reasonPhrase];
}

const REASON_PHRASE_TO_STATUS: Readonly<Record<string, number>> = {
  "bad request": 400,
  unauthorized: 401,
  forbidden: 403,
  "not found": 404,
  "request timeout": 408,
  "too many requests": 429,
  "internal server error": 500,
  "bad gateway": 502,
  "service unavailable": 503,
  "gateway timeout": 504,
};

/**
 * The SDK's own request timeout (`httpOptions.timeout`, wired via
 * `AbortSignal.timeout()` internally) surfaces as a standard DOM
 * `AbortError`/`TimeoutError`, not as anything with an HTTP `status` —
 * no response was ever received. Checked by `name` rather than
 * `instanceof DOMException` so this also matches an equivalent plain
 * `Error` in environments/mocks that don't throw a real `DOMException`,
 * and checked only *after* `extractStatusInfo()` finds nothing, so a
 * genuine HTTP-level error is never miscategorized as a timeout merely
 * because its `name` happens to collide.
 */
function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
