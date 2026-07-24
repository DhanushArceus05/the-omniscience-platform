import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type { ModelCapability, ModelId, ModelMetadata, ProviderCapability } from "@omniscience/types";
import { ENV } from "../../config/config.constants";
import { aiDomainError } from "../ai-provider.interface";
import { GEMINI_CLIENT, type GeminiModelsClient } from "./gemini-client.provider";
import { mapGeminiError } from "./gemini-error-mapper";
import { StubProviderDescriptor } from "./stub-provider.base";

/**
 * The maximum number of output tokens requested per `generateText`
 * call. Fixed rather than configurable in this step — same reasoning,
 * and same numeric value, as `AnthropicProvider`'s
 * `DEFAULT_MAX_TOKENS`: no requirement has asked for a per-request or
 * env-configurable token budget yet, and keeping both real adapters'
 * defaults identical avoids an unexplained asymmetry between them. A
 * future step can make this configurable (per-request or per-model)
 * without changing this method's public contract.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/**
 * Google Gemini — the second *real* OmniProvider adapter (Phase 4
 * Step 4), following the exact pattern `AnthropicProvider` established
 * in Step 2: `generateText` makes a genuine `@google/genai`
 * `models.generateContent` call; `generateStructured` and `embed`
 * remain `NOT_IMPLEMENTED` (inherited from `StubProviderDescriptor`,
 * unchanged) — neither is implemented by this adapter, so neither
 * capability is advertised (see `capabilities`/each model's own
 * `capabilities` below, trimmed to `text-generation` only for the same
 * reason Step 2 trimmed Anthropic's).
 *
 * The injected `client` is typed as the narrow `GeminiModelsClient`
 * interface (see `gemini-client.provider.ts`), not the concrete SDK
 * class — production resolves it to a real `GoogleGenAI` client via the
 * `GEMINI_CLIENT` DI token; tests inject a fake implementing the same
 * interface, so no test ever makes a live vendor network call.
 *
 * `configStatus()`/`isReady()` are unchanged from Step 1 — still purely
 * configuration-based (`GEMINI_API_KEY` present or not). No health
 * tracking or circuit-breaking was added in this step, matching
 * Anthropic's own "known limitation" — that remains a dedicated later
 * Phase 4 step for every provider at once, not something to
 * special-case per adapter.
 *
 * The two models registered below (`gemini-3.5-flash`/`gemini-2.5-pro`)
 * replace Step 1's placeholder `gemini-1.5-flash`/`gemini-1.5-pro`
 * entries, which the vendor has since discontinued (the 1.5 series
 * returns a 404 for every request as of this step) — a real adapter
 * must be registered against models that are actually callable.
 */
@Injectable()
export class GeminiProvider extends StubProviderDescriptor {
  readonly providerId = "gemini";
  readonly displayName = "Google Gemini";
  // Trimmed to only what this adapter genuinely implements this step —
  // see the class doc comment. Step 1 advertised vision/structured-
  // output/tool-calling/streaming here too, but nothing backed those
  // claims; restoring any of them is a later step's work, done together
  // with the method that actually implements it.
  readonly capabilities: readonly ProviderCapability[] = ["text-generation"];
  readonly priority = 10;

  protected readonly models: readonly ModelMetadata[] = [
    {
      providerId: "gemini",
      modelId: "gemini-3.5-flash",
      displayName: "Gemini 3.5 Flash",
      capabilities: ["text-generation"],
      availability: "available",
      priority: 10,
      contextWindowTokens: 1_000_000,
    },
    {
      providerId: "gemini",
      modelId: "gemini-2.5-pro",
      displayName: "Gemini 2.5 Pro",
      capabilities: ["text-generation"],
      availability: "available",
      priority: 20,
      contextWindowTokens: 1_000_000,
    },
  ];

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(GEMINI_CLIENT) private readonly client: GeminiModelsClient,
  ) {
    super();
  }

  protected hasCredential(): boolean {
    return this.env.GEMINI_API_KEY !== undefined;
  }

  /**
   * Unlike the inherited stub default (always `false`), this adapter
   * has a genuinely executable `generateText` — but only that one
   * capability; `generateStructured`/`embed` remain inherited,
   * unimplemented `NOT_IMPLEMENTED` throws (see the class doc comment),
   * so this must stay narrow rather than mirroring `capabilities`.
   */
  override supportsExecution(capability: ModelCapability): boolean {
    return capability === "text-generation";
  }

  /**
   * Real execution — see the class doc comment for what's implemented
   * and what remains deferred. Every failure path (missing credential,
   * an unregistered/foreign model id, a mapped SDK error, or an
   * empty/unsupported response) throws the normalized domain errors
   * this module's callers already know how to handle — never a raw
   * SDK exception.
   */
  override async generateText(modelId: ModelId, prompt: string): Promise<string> {
    // 1. Credential must be present before anything else is attempted —
    //    same ordering, and same reasoning, as `AnthropicProvider`.
    if (!this.hasCredential()) {
      throw aiDomainError(
        "PROVIDER_NOT_CONFIGURED",
        `Provider "${this.providerId}" has no configured credentials.`,
      );
    }

    // 2. The model must be one of *this* provider's own registered
    //    models — never an arbitrary/unregistered id, and never a
    //    model id that belongs to a different provider. See
    //    `AnthropicProvider.generateText`'s identical check for the
    //    full reasoning.
    const model = this.models.find((candidate) => candidate.modelId === modelId);
    if (!model) {
      throw aiDomainError(
        "MODEL_NOT_FOUND",
        `No model "${modelId}" is registered for provider "${this.providerId}".`,
      );
    }

    let response;
    try {
      response = await this.client.models.generateContent({
        model: modelId,
        contents: prompt,
        config: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS },
      });
    } catch (error) {
      // Retries already happened (or were correctly skipped) inside the
      // SDK client itself, per its own `retryOptions` configuration —
      // see `gemini-client.provider.ts`. This is the final outcome.
      throw mapGeminiError(error, { providerId: this.providerId, modelId });
    }

    const text = response.text?.trim() ?? "";

    if (text.length === 0) {
      // Either the SDK's own `text` getter returned `undefined` (no
      // text content at all — e.g. a safety block with zero candidates)
      // or the only text present was empty/whitespace. Never silently
      // return an empty string as if it were a real answer.
      throw aiDomainError(
        "PROVIDER_RESPONSE_INVALID",
        `Provider "${this.providerId}" returned an empty or unsupported response for model "${modelId}".`,
      );
    }

    return text;
  }
}
