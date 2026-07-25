import type { HttpException } from "@nestjs/common";
import type { Logger } from "pino";
import type { ModelId, ProviderId } from "@omniscience/types";
import { aiDomainError } from "../ai-provider.interface";
import {
  describeUnrecognizedError,
  extractStatusInfo,
  isTimeoutErrorByName,
} from "./provider-error-utils";

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
 * bucket instead of `PROVIDER_AUTH_FAILED`. See
 * `provider-error-utils.ts`'s doc comment for the full reasoning (now
 * shared with `anthropic-error-mapper.ts`, which gained the same
 * defense-in-depth in Phase 4 Step 5). This mapper does structural
 * (duck-typed) detection instead — `extractStatusInfo()` reads
 * `.status` directly off the thrown value, and if that's absent, off up
 * to a few levels of `.cause`, regardless of which concrete class
 * produced it. This is strictly more robust than the nominal check it
 * replaces and covers the nominal case too (a real `ApiError` instance
 * has an own `status` property, so it's found on the very first,
 * zero-`cause`-traversal check).
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
 * catch-all for a 401/403/429/5xx. This is Gemini-specific (the
 * `p-retry` message wording is this SDK's, not a general concept), so it
 * stays local to this file rather than living in the shared
 * `provider-error-utils.ts` — passed in as `extractStatusInfo()`'s
 * opt-in `fallbackFromMessage` hook.
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
 *
 * `logger`, if given (Phase 4 Step 5), is used for exactly one thing:
 * a `warn`-level, secret-free structural fingerprint (never the raw
 * message) when — and only when — every classification attempt above
 * has failed and this function is about to fall back to the generic
 * "failed unexpectedly" bucket. This is what would have surfaced the
 * original `instanceof ApiError` gap immediately in production logs
 * instead of requiring a manual runtime investigation to discover it.
 * Optional (and a structural `Pick<Logger, "warn">` rather than the
 * full `pino.Logger` type) so every existing call site and test that
 * doesn't care about logging keeps working unchanged.
 */
export function mapGeminiError(
  error: unknown,
  context: { readonly providerId: ProviderId; readonly modelId: ModelId },
  logger?: Pick<Logger, "warn">,
): HttpException {
  const { providerId, modelId } = context;

  const statusInfo = extractStatusInfo(error, {
    fallbackFromMessage: extractStatusFromRetryWrapperMessage,
  });
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

  if (isTimeoutErrorByName(error)) {
    return aiDomainError(
      "PROVIDER_TIMEOUT",
      `Provider "${providerId}" timed out generating text for model "${modelId}".`,
    );
  }

  // Not a recognized error shape at all — no numeric status anywhere
  // in the error or its `.cause` chain, and not a timeout (a network-
  // level failure, a bug, an unexpected throw, etc.). Still normalized,
  // still no internal detail leaked — but worth a warn-level, secret-
  // free structural fingerprint so this doesn't go unnoticed the way
  // the original `instanceof ApiError` gap did.
  logger?.warn(
    { providerId, modelId, ...describeUnrecognizedError(error) },
    "gemini: unrecognized error shape while generating text; falling back to PROVIDER_UNAVAILABLE",
  );
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
