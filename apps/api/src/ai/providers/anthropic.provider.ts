import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type { ModelId, ModelMetadata, ProviderCapability } from "@omniscience/types";
import { ENV } from "../../config/config.constants";
import { aiDomainError } from "../ai-provider.interface";
import { ANTHROPIC_CLIENT, type AnthropicMessagesClient } from "./anthropic-client.provider";
import { mapAnthropicError } from "./anthropic-error-mapper";
import { StubProviderDescriptor } from "./stub-provider.base";

/**
 * The maximum number of tokens requested per `generateText` call.
 * Fixed rather than configurable in this step — no requirement asked
 * for a per-request or env-configurable token budget yet, and a fixed,
 * conservative value keeps this first real integration simple. A
 * future step can make this configurable (per-request or per-model)
 * without changing this method's public contract.
 */
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Anthropic — the first *real* OmniProvider adapter (Phase 4 Step 2).
 * `generateText` makes a genuine `@anthropic-ai/sdk` `messages.create`
 * call; `generateStructured` and `embed` remain `NOT_IMPLEMENTED`
 * (inherited from `StubProviderDescriptor`, unchanged from Step 1) —
 * neither is implemented by this adapter yet, so neither capability is
 * advertised (see `capabilities`/each model's own `capabilities` below,
 * trimmed to `text-generation` only for the same reason).
 *
 * The injected `client` is typed as the narrow `AnthropicMessagesClient`
 * interface (see `anthropic-client.provider.ts`), not the concrete SDK
 * class — production resolves it to a real `Anthropic` client via the
 * `ANTHROPIC_CLIENT` DI token; tests inject a fake implementing the
 * same interface, so no test ever makes a live vendor network call.
 *
 * `configStatus()`/`isReady()` are unchanged from Step 1 — still purely
 * configuration-based (`ANTHROPIC_API_KEY` present or not). No health
 * tracking or circuit-breaking was added in this step, by explicit
 * instruction; that remains a dedicated later Phase 4 step.
 */
@Injectable()
export class AnthropicProvider extends StubProviderDescriptor {
  readonly providerId = "anthropic";
  readonly displayName = "Anthropic";
  // Trimmed to only what this adapter genuinely implements this step.
  // Step 1 advertised vision/structured-output/tool-calling/streaming
  // here too, but nothing backed those claims — leaving them in place
  // once real execution exists would mean `GET /ai/providers` and the
  // model-selector could route a caller to a capability that still
  // just throws `NOT_IMPLEMENTED`. Restoring them is a later step's
  // work, done together with the method that actually implements them.
  readonly capabilities: readonly ProviderCapability[] = ["text-generation"];
  readonly priority = 15;

  protected readonly models: readonly ModelMetadata[] = [
    {
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      displayName: "Claude Sonnet 5",
      capabilities: ["text-generation"],
      availability: "available",
      priority: 10,
      contextWindowTokens: 200_000,
    },
    {
      providerId: "anthropic",
      modelId: "claude-haiku-4-5",
      displayName: "Claude Haiku 4.5",
      capabilities: ["text-generation"],
      availability: "available",
      priority: 25,
      contextWindowTokens: 200_000,
    },
  ];

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(ANTHROPIC_CLIENT) private readonly client: AnthropicMessagesClient,
  ) {
    super();
  }

  protected hasCredential(): boolean {
    return this.env.ANTHROPIC_API_KEY !== undefined;
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
    //    there is no point validating the model id just to fail on
    //    configuration a moment later, and this ordering matches the
    //    approved scope's own listing (credential check first).
    if (!this.hasCredential()) {
      throw aiDomainError(
        "PROVIDER_NOT_CONFIGURED",
        `Provider "${this.providerId}" has no configured credentials.`,
      );
    }

    // 2. The model must be one of *this* provider's own registered
    //    models — never an arbitrary/unregistered id, and never a
    //    model id that belongs to a different provider. Checking
    //    membership in `this.models` (rather than, say, a bare
    //    string/format check) enforces both at once: a model id that
    //    is well-formed but simply doesn't exist here, and a model id
    //    that exists but belongs to Gemini/OpenAI, are both rejected
    //    identically.
    const model = this.models.find((candidate) => candidate.modelId === modelId);
    if (!model) {
      throw aiDomainError(
        "MODEL_NOT_FOUND",
        `No model "${modelId}" is registered for provider "${this.providerId}".`,
      );
    }

    let response;
    try {
      response = await this.client.messages.create({
        model: modelId,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (error) {
      // Retries already happened (or were correctly skipped) inside the
      // SDK client itself, per its own `maxRetries` configuration — see
      // `anthropic-client.provider.ts`. This is the final outcome.
      throw mapAnthropicError(error, { providerId: this.providerId, modelId });
    }

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (text.length === 0) {
      // Either no text block came back at all, or every text block was
      // empty — e.g. the model only returned a content type this
      // adapter doesn't support extracting text from. Never silently
      // return an empty string as if it were a real answer.
      throw aiDomainError(
        "PROVIDER_RESPONSE_INVALID",
        `Provider "${this.providerId}" returned an empty or unsupported response for model "${modelId}".`,
      );
    }

    return text;
  }
}
