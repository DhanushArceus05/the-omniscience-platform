/**
 * OmniProvider & Model Manager foundation (Phase 4 Step 1).
 *
 * These are provider-neutral contracts shared by `@omniscience/api`'s
 * `ai` module (registry, catalog, selector) and, eventually, any
 * consumer of `GET /ai/providers` / `GET /ai/models`. Nothing here
 * couples to a specific vendor — the `Provider Rule` in
 * `docs/04_System_Architecture.md` ("business logic requests
 * capabilities, never vendor names") applies to this whole file.
 *
 * Per the Phase 4 Step 1 scope, this is the foundation only: no real
 * provider execution happens yet (see `ProviderExecutionMetadata` and
 * the `NOT_IMPLEMENTED` domain error convention in the `ai` module).
 */

/** Stable identifier for a registered provider, e.g. `"gemini"`, `"openai"`, `"anthropic"`, `"local"`. */
export type ProviderId = string;

/** Stable identifier for a model, unique *within* its provider (e.g. `"gpt-4o"`). */
export type ModelId = string;

/**
 * A capability a *provider* can support at all (independent of any one
 * model). Kept distinct from `ModelCapability` because a provider may
 * support a capability in general while a specific model does not.
 */
export type ProviderCapability =
  | "text-generation"
  | "embeddings"
  | "vision"
  | "speech-to-text"
  | "text-to-speech"
  | "structured-output"
  | "tool-calling"
  | "streaming";

/** A capability a specific *model* supports. Same vocabulary as `ProviderCapability` by design. */
export type ModelCapability = ProviderCapability;

/** Whether a provider currently has valid configuration (e.g. an API key present and well-formed). */
export type ProviderConfigStatus = "configured" | "not-configured";

/** Whether a model is currently eligible for selection. */
export type ModelAvailability = "available" | "unavailable";

/**
 * Static metadata describing one model. Deliberately data-only — no
 * behavior, no client, no vendor SDK reference. `costPerMillionTokens`,
 * `averageLatencyMs`, and `contextWindowTokens` are optional because
 * they are not always known/published for every model up front, and
 * selection must degrade gracefully when they are absent (see
 * `ModelSelectionRequest`/the selector's algorithm).
 */
export interface ModelMetadata {
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
  /** Human-readable display name, e.g. "Gemini 1.5 Flash". */
  readonly displayName: string;
  readonly capabilities: readonly ModelCapability[];
  readonly availability: ModelAvailability;
  /**
   * Lower number = higher priority. Used only as the final tiebreaker in
   * `ModelSelectionResult` — an explicit preferred provider/model always
   * wins over priority. Ties are broken by catalog registration order.
   */
  readonly priority: number;
  readonly costPerMillionTokens?: number;
  readonly averageLatencyMs?: number;
  readonly contextWindowTokens?: number;
}

/** Static, provider-level metadata — independent of any one model. */
export interface ProviderMetadata {
  readonly providerId: ProviderId;
  readonly displayName: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly configStatus: ProviderConfigStatus;
  /** Lower number = higher priority; same tiebreaker role as `ModelMetadata.priority`, at the provider level. */
  readonly priority: number;
}

/**
 * Input to the deterministic model-selection algorithm
 * (`ModelSelectorService.select`, Phase 4 Step 1). See that service's
 * doc comment for the exact precedence rules.
 */
export interface ModelSelectionRequest {
  /** Every capability in this list must be present on a candidate model for it to be eligible. */
  readonly requiredCapabilities: readonly ModelCapability[];
  readonly preferredProviderId?: ProviderId;
  readonly preferredModelId?: ModelId;
}

/** Successful output of `ModelSelectorService.select`. */
export interface ModelSelectionResult {
  readonly model: ModelMetadata;
  /**
   * Which selection rule matched, for observability/testability —
   * never used to change behavior, only to explain a result.
   */
  readonly matchedRule: "preferred-model" | "preferred-provider" | "priority-fallback";
}

/**
 * Metadata describing a provider execution attempt. Step 1 never
 * actually calls a vendor, so today every real adapter's execution
 * methods throw before producing one of these — the shape exists so
 * future phases have a stable contract to fill in without another
 * breaking type change.
 */
export interface ProviderExecutionMetadata {
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
}

/** `GET /ai/providers` response — safe metadata only, never secrets. */
export interface ListProvidersResponse {
  readonly providers: readonly ProviderMetadata[];
}

/** `GET /ai/models` response — safe metadata only, never secrets. */
export interface ListModelsResponse {
  readonly models: readonly ModelMetadata[];
}

/**
 * `POST /ai/generate` request body (Phase 4 Step 3). Deliberately just
 * a prompt — routing fields (`requiredCapabilities`,
 * `preferredProviderId`, `preferredModelId`) are an internal
 * `AiService` concern, never a public input; see
 * `packages/schemas/src/ai-provider.ts`'s `.strict()` schema, which
 * rejects any of those fields if a caller sends them.
 */
export interface GenerateTextRequest {
  readonly prompt: string;
}

/**
 * `POST /ai/generate` response — the generated text plus which
 * provider/model actually served it. Deliberately excludes
 * `matchedRule` and any other internal routing/debug metadata from
 * `ModelSelectionResult`.
 */
export interface GenerateTextResponse {
  readonly text: string;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}

