import type { HttpException } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import type { ModelId, ProviderId } from "@omniscience/types";
import { aiDomainError } from "../ai-provider.interface";

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
 */
export function mapAnthropicError(
  error: unknown,
  context: { readonly providerId: ProviderId; readonly modelId: ModelId },
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

  // Not a recognized SDK error shape at all (a bug, an unexpected
  // throw, etc.) — still normalized, still no internal detail leaked.
  return aiDomainError(
    "PROVIDER_UNAVAILABLE",
    `Provider "${providerId}" failed unexpectedly while generating text for model "${modelId}".`,
  );
}
