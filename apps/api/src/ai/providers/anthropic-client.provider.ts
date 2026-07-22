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
export interface AnthropicMessagesClient {
  readonly messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message>;
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
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY ?? "not-configured",
    timeout: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
  });
}

/** Nest provider for `ANTHROPIC_CLIENT` — real SDK client, built from the validated `Env`. */
export const anthropicClientProvider: Provider = {
  provide: ANTHROPIC_CLIENT,
  inject: [ENV],
  useFactory: (env: Env): AnthropicMessagesClient => createAnthropicClient(env),
};
