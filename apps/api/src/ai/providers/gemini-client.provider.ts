import type { Provider } from "@nestjs/common";
import { GoogleGenAI } from "@google/genai";
import type { Env } from "@omniscience/config";
import { ENV } from "../../config/config.constants";

/**
 * DI token for the injectable Gemini content-generation client (Phase 4
 * Step 4). `GeminiProvider` depends on the narrow `GeminiModelsClient`
 * interface below, injected via this token — never on the concrete
 * `GoogleGenAI` SDK class directly. Same technique
 * `anthropic-client.provider.ts` already established for Anthropic:
 * production resolves a real `@google/genai` client, while unit/e2e
 * tests inject a fake implementing the same interface, so no test ever
 * makes a live vendor network call.
 */
export const GEMINI_CLIENT = "GEMINI_CLIENT";

/**
 * The minimal request shape `GeminiProvider` actually sends. Narrower
 * than the SDK's own `GenerateContentParameters` (which also accepts
 * multi-part/multi-turn `Content[]` contents, tool declarations, safety
 * settings, etc.) — this adapter only ever sends a single-turn plain
 * text prompt with an output-length cap, matching the scope of this
 * step (`generateText` only).
 */
export interface GeminiGenerateContentParams {
  readonly model: string;
  readonly contents: string;
  readonly config?: {
    readonly maxOutputTokens?: number;
  };
}

/**
 * The minimal response shape `GeminiProvider` actually reads. The real
 * SDK's `GenerateContentResponse` exposes far more (candidates, usage
 * metadata, safety ratings, etc.) — only `text` (the SDK's own
 * "concatenation of all text parts from the first candidate" getter,
 * which safely returns `undefined` rather than throwing when there is
 * no text content) is ever consulted here.
 */
export interface GeminiGenerateContentResult {
  readonly text: string | undefined;
}

/**
 * The minimal slice of the `@google/genai` client's surface
 * `GeminiProvider` actually calls — deliberately narrow (one method),
 * for the same reason `AnthropicMessagesClient` is narrow: easy to fake
 * in tests, and the type alone makes it obvious no other SDK surface
 * (chats, files, batches, live, tunings, etc.) is used by this adapter
 * in this step.
 */
export interface GeminiModelsClient {
  readonly models: {
    generateContent(params: GeminiGenerateContentParams): Promise<GeminiGenerateContentResult>;
  };
}

/**
 * Builds the real `GoogleGenAI` SDK client for production use.
 *
 * `apiKey` always receives a concrete string, never `undefined` — same
 * reasoning as `anthropic-client.provider.ts`'s `createAnthropicClient`:
 * `Env` is the single source of truth for configuration, and this
 * factory must never crash or behave unpredictably purely because
 * `GEMINI_API_KEY` is unset (Step 1's standing guarantee that a missing
 * provider key never blocks API startup). The placeholder value is
 * never a valid credential and is never used for a real request:
 * `GeminiProvider.hasCredential()`/`isReady()` gates every execution
 * attempt before this client is ever called.
 *
 * ## Why `httpOptions.retryOptions` is deliberately NOT set
 *
 * An earlier version of this factory passed
 * `retryOptions: { attempts: env.AI_MAX_RETRIES + 1 }`, mirroring
 * Anthropic's own timeout/retry wiring. A real local run then showed an
 * invalid `GEMINI_API_KEY` being classified as `PROVIDER_UNAVAILABLE`
 * instead of `PROVIDER_AUTH_FAILED` even after `gemini-error-mapper.ts`
 * was made fully structural (status-and-`.cause`-based rather than
 * `instanceof`-based). Tracing the exact installed
 * `@google/genai@2.13.0` bundle (`dist/node/index.cjs`) found the real
 * cause: `ApiClient.apiCall()` only returns the raw `Response` object
 * (which its caller then checks via `throwErrorIfNotOK()` — the
 * function that builds a real `ApiError` carrying `.status` and the
 * parsed JSON error body) when `httpOptions.retryOptions` is **absent**.
 * As soon as `retryOptions` is configured, `apiCall()` instead routes
 * every request through the bundled `p-retry` package: a non-retryable
 * status (e.g. 400 for a bad API key) throws `p-retry`'s own
 * `AbortError`, which `p-retry` immediately unwraps to its
 * `.originalError` — a **plain `new Error(message)`** with no `.status`,
 * no `.cause`, and a message containing only the bare HTTP reason phrase
 * (e.g. `"Non-retryable exception Bad Request sending request"`), never
 * the actual response body. A retryable status that's exhausted its
 * retries similarly surfaces as a plain `Error('Retryable HTTP Error: ' +
 * statusText)`. Either way, by the time the error reaches
 * `GeminiProvider`/`mapGeminiError`, every piece of structured
 * information needed for correct classification — for *any* HTTP
 * status, not just auth failures — has already been discarded, no
 * matter how thoroughly the mapper inspects the error's own shape or
 * `.cause` chain.
 *
 * Since accurate error classification is a hard requirement of this
 * step and the SDK's own automatic retry-on-5xx/429/408 is best-effort
 * convenience, not a correctness requirement, this factory omits
 * `retryOptions` entirely — trading away the SDK's internal retry loop
 * for every request reliably reaching the informative `ApiError` path.
 * `httpOptions.timeout` is unaffected by this (it's applied to the
 * underlying `fetch` independently of the `retryOptions` branch in
 * `apiCall()`) and is still read from `AI_REQUEST_TIMEOUT_MS`.
 * `AI_MAX_RETRIES` remains defined in `Env` and still governs
 * Anthropic's client; it is intentionally not applied to Gemini's for
 * the reason above — see the "Known limitations" note in
 * `claude/CURRENT_PHASE.md` for the resulting deferred item (an
 * external, response-status-aware retry loop that doesn't depend on
 * this SDK's own retry implementation).
 */
function createGeminiClient(env: Env): GeminiModelsClient {
  return new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY ?? "not-configured",
    httpOptions: {
      timeout: env.AI_REQUEST_TIMEOUT_MS,
    },
  });
}

/** Nest provider for `GEMINI_CLIENT` — real SDK client, built from the validated `Env`. */
export const geminiClientProvider: Provider = {
  provide: GEMINI_CLIENT,
  inject: [ENV],
  useFactory: (env: Env): GeminiModelsClient => createGeminiClient(env),
};
