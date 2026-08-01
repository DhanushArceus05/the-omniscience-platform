import type { Provider } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "@omniscience/config";
import { ENV } from "../../config/config.constants";

/**
 * DI token for the injectable Anthropic Messages client (Phase 4
 * Step 2). `AnthropicProvider` depends on the narrow
 * `AnthropicMessagesClient` interface below, injected via this token —
 * never on the concrete `Anthropic` SDK class directly. This is what
 * lets production wire the real SDK client while unit/controller tests
 * inject a fake object implementing the same interface, with no live
 * vendor network call ever happening in a test.
 */
export const ANTHROPIC_CLIENT = "ANTHROPIC_CLIENT";

/**
 * The minimal slice of the `@anthropic-ai/sdk` client's surface
 * `AnthropicProvider` actually calls. Deliberately narrow (one method)
 * rather than typing the injected value as the full `Anthropic` class —
 * a narrower interface is both easier to fake in tests and makes it
 * obvious, by the type alone, that no other SDK capability (batches,
 * files, models listing, beta namespaces, etc.) is used by this
 * adapter in Step 2.
 */
/** The result of starting a streamed Anthropic call — the one thing `AnthropicProvider.generateTextStream` actually needs: incremental text chunks, in order, as they arrive. Deliberately narrower than the SDK's own `MessageStream` (no `.finalMessage()`, no raw event access, no `.on(...)` listeners) — same "narrow interface, easy to fake in tests" reasoning `AnthropicMessagesClient` itself already documents. */
export interface AnthropicTextStream {
  readonly textStream: AsyncIterable<string>;
}

export interface AnthropicMessagesClient {
  readonly messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message>;
    /**
     * The streaming counterpart to `create` (Phase 4 Step 2 → Phase 6
     * Step 2). Takes the same request shape `create` does (model,
     * max_tokens, messages) — streaming vs. non-streaming is a
     * property of *which method is called*, not an extra `stream:
     * true` flag a caller could get wrong — plus an optional
     * `AbortSignal` so an in-flight vendor request can actually be
     * cancelled, not just have its result discarded.
     */
    stream(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { readonly signal?: AbortSignal },
    ): AnthropicTextStream;
  };
}

/**
 * Builds the real `Anthropic` SDK client for production use.
 *
 * `apiKey` always receives a concrete string, never `undefined` —
 * passing `undefined` would make the SDK's own constructor fall back to
 * reading `process.env.ANTHROPIC_API_KEY` (or, in some SDK versions,
 * attempt a lazy credential-chain resolution) when the property is
 * present-but-`undefined` in the options object, which this codebase
 * does not want: `Env` is the single source of truth for configuration
 * (Claude Development Rule — never read `process.env` directly outside
 * `packages/config`), and this factory must never crash or behave
 * unpredictably purely because `ANTHROPIC_API_KEY` is unset (Step 1's
 * standing guarantee that a missing provider key never blocks API
 * startup). The placeholder value is never a valid credential and is
 * never used for a real request: `AnthropicProvider.hasCredential()`/
 * `isReady()` gates every execution attempt before this client is ever
 * called, exactly as Step 1 already established for the other two stub
 * providers' `configStatus()` checks.
 *
 * `timeout`/`maxRetries` are read from the validated `Env` (Phase 4
 * Step 2's `AI_REQUEST_TIMEOUT_MS`/`AI_MAX_RETRIES`) and handed straight
 * to the SDK's own constructor options — this is the *only* place
 * either value is used. There is no second, custom retry/backoff loop
 * anywhere in this module; the SDK already knows which failures are
 * safe to retry (429, most 5xx, and network/timeout errors) and which
 * are not (4xx client errors), and re-implementing that policy here
 * would risk double-retrying or disagreeing with the SDK's own rules.
 */
function createAnthropicClient(env: Env): AnthropicMessagesClient {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY ?? "not-configured",
    timeout: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
  });

  // Explicitly adapted (rather than returning `client` directly, which
  // Step 2's `create`-only interface could get away with via
  // structural typing) now that `AnthropicMessagesClient` also
  // declares `stream`. The installed `@anthropic-ai/sdk` version's own
  // `messages.stream(...)` return type has no `.textStream` convenience
  // property in its public type declarations (only a raw
  // `AsyncIterable` of Messages-API SSE events — `message_start`,
  // `content_block_start`, `content_block_delta`, `content_block_stop`,
  // `message_delta`, `message_stop`: the same stable, publicly
  // documented event set the Messages API itself emits over the wire),
  // so `extractTextDeltas` below does that extraction itself. This
  // wrapper is the one place any of this is adapted, so nothing else in
  // this module ever references SDK members `AnthropicMessagesClient`
  // doesn't declare.
  return {
    messages: {
      create: (params) => client.messages.create(params),
      stream: (params, options) => ({
        textStream: extractTextDeltas(client.messages.stream(params, options)),
      }),
    },
  };
}

/**
 * Narrows the real SDK's raw Messages-API SSE event stream down to
 * plain text chunks. `events`'s type is derived directly from the
 * installed `@anthropic-ai/sdk` version's own declared return type for
 * `messages.stream(...)` (`ReturnType<Anthropic["messages"]["stream"]>`)
 * rather than a hand-written approximation of it, so this stays
 * correct across SDK versions without needing to know or name that
 * return type.
 *
 * Only a `content_block_delta` event whose `delta.type` is
 * `"text_delta"` ever produces a chunk — every other event type
 * (including `input_json_delta`, for a tool-use content block this
 * adapter never requests) is silently skipped, exactly like this
 * adapter's non-streaming `generateText` already only ever reads
 * `content` blocks of `type: "text"` and ignores the rest.
 */
async function* extractTextDeltas(
  events: ReturnType<Anthropic["messages"]["stream"]>,
): AsyncGenerator<string> {
  for await (const event of events) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

/** Nest provider for `ANTHROPIC_CLIENT` — real SDK client, built from the validated `Env`. */
export const anthropicClientProvider: Provider = {
  provide: ANTHROPIC_CLIENT,
  inject: [ENV],
  useFactory: (env: Env): AnthropicMessagesClient => createAnthropicClient(env),
};
