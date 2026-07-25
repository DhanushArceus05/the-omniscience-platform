import type { HttpException } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";
import type { ModelId, ProviderId } from "@omniscience/types";
import { aiDomainError } from "../ai-provider.interface";
import { describeUnrecognizedError, extractStatusInfo, isTimeoutErrorByName } from "./provider-error-utils";

/**
 * Normalizes every failure `AnthropicProvider.generateText` can
 * encounter into exactly one of this module's existing
 * `AiDomainErrorCode`s, via the shared `aiDomainError()` builder — the
 * same convention every other domain error in this module already
 * uses. This is the **only** place `@anthropic-ai/sdk`-specific error
 * types are referenced anywhere in the `ai` module; every caller of
 * `AnthropicProvider` sees only the normalized `HttpException`.
 *
 * Never includes the SDK error's own `message`, `error` (raw response
 * body), or `headers` in the thrown message — only a fixed, generic
 * description per category and, where meaningful, the numeric HTTP
 * status the vendor returned (not sensitive; standard HTTP semantics).
 * This satisfies the requirement that API keys, raw SDK error bodies,
 * request headers, and other vendor-internal details never reach a
 * caller, even indirectly through an error message.
 *
 * Retries themselves are handled entirely by the SDK client's own
 * `maxRetries` configuration (see `anthropic-client.provider.ts`) —
 * by the time an error reaches this function, the SDK has already
 * exhausted whatever retry attempts it judged safe for that failure
 * type. This function only classifies the *final* outcome.
 *
 * ## Defense-in-depth structural fallback (Phase 4 Step 5)
 *
 * The primary classification path below is unchanged from Phase 4
 * Step 2 and is still `instanceof` checks against `@anthropic-ai/sdk`'s
 * own typed error class hierarchy — that hierarchy is public API the
 * SDK is unlikely to restructure, and nominal checks against it have
 * never actually failed in this codebase the way the equivalent Gemini
 * checks did. Even so, Phase 4 Step 4's real-world incident (an
 * `instanceof` check silently failing for reasons entirely outside this
 * codebase's control — see `provider-error-utils.ts`'s doc comment)
 * showed that relying on nominal checks *alone*, with no fallback at
 * all, is a real production risk for *any* vendor SDK, not just
 * Google's. So, after every specific `instanceof` check below has
 * failed to match, this mapper now also attempts the same structural
 * `extractStatusInfo()`/`isTimeoutErrorByName()` detection
 * `gemini-error-mapper.ts` already uses, before giving up to the
 * generic final fallback. This changes nothing about any error shape
 * already covered by an `instanceof` check above (those still match
 * first, unchanged) — it only adds coverage for a shape that matches
 * none of them (e.g. a dual-package-hazard duplicate of one of these
 * classes, or a future SDK version that wraps an error differently).
 *
 * `logger`, if given, is used for exactly one thing: a `warn`-level,
 * secret-free structural fingerprint (never the raw message) when every
 * classification attempt has failed and this function is about to fall
 * back to the generic "failed unexpectedly" bucket. Optional (and a
 * structural `Pick<Logger, "warn">` rather than the full `pino.Logger`
 * type) so every existing call site and test that doesn't care about
 * logging keeps working unchanged.
 */
export function mapAnthropicError(
  error: unknown,
  context: { readonly providerId: ProviderId; readonly modelId: ModelId },
  logger?: Pick<Logger, "warn">,
): HttpException {
  const { providerId, modelId } = context;

  // Order matters: `APIConnectionTimeoutError` and the other named
  // subclasses all extend `APIConnectionError`/`APIError`, so the most
  // specific checks must run first.
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return aiDomainError(
      "PROVIDER_TIMEOUT",
      `Provider "${providerId}" timed out generating text for model "${modelId}".`,
    );
  }

  if (error instanceof Anthropic.APIConnectionError) {
    // Network-level failure — no HTTP response was ever received, so
    // there is no status code to branch on. Treated as the provider
    // being unavailable right now, not a caller error.
    return aiDomainError(
      "PROVIDER_UNAVAILABLE",
      `Provider "${providerId}" could not be reached while generating text for model "${modelId}".`,
    );
  }

  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return aiDomainError(
      "PROVIDER_AUTH_FAILED",
      `Provider "${providerId}" rejected its configured credentials.`,
    );
  }

  if (error instanceof Anthropic.RateLimitError) {
    return aiDomainError(
      "PROVIDER_RATE_LIMITED",
      `Provider "${providerId}" is rate-limiting requests right now.`,
    );
  }

  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return aiDomainError(
      "PROVIDER_REQUEST_INVALID",
      `Provider "${providerId}" rejected the request for model "${modelId}" as invalid.`,
    );
  }

  if (error instanceof Anthropic.InternalServerError) {
    return aiDomainError(
      "PROVIDER_UNAVAILABLE",
      `Provider "${providerId}" is currently unavailable (upstream error).`,
    );
  }

  if (error instanceof Anthropic.APIError) {
    // Any other HTTP-level APIError this module doesn't special-case
    // (e.g. 404/409 from the vendor) — still never surfaced as a raw
    // vendor error; treated as the provider being unusable right now.
    return aiDomainError(
      "PROVIDER_UNAVAILABLE",
      `Provider "${providerId}" returned an unexpected error for model "${modelId}".`,
    );
  }

  // None of the SDK's own typed classes matched — see the "Defense-in-
  // depth structural fallback" section of this function's doc comment.
  const statusInfo = extractStatusInfo(error);
  if (statusInfo !== undefined) {
    const { status } = statusInfo;

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

    if (status === 400 || status === 422) {
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

  // Not a recognized SDK error shape at all (a bug, an unexpected
  // throw, etc.) — still normalized, still no internal detail leaked —
  // but worth a warn-level, secret-free structural fingerprint so this
  // doesn't go unnoticed the way the original Gemini `instanceof`
  // gap did.
  logger?.warn(
    { providerId, modelId, ...describeUnrecognizedError(error) },
    "anthropic: unrecognized error shape while generating text; falling back to PROVIDER_UNAVAILABLE",
  );
  return aiDomainError(
    "PROVIDER_UNAVAILABLE",
    `Provider "${providerId}" failed unexpectedly while generating text for model "${modelId}".`,
  );
}
