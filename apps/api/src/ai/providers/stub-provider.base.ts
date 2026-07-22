import type {
  ModelCapability,
  ModelId,
  ModelMetadata,
  ProviderCapability,
  ProviderConfigStatus,
  ProviderId,
} from "@omniscience/types";
import { notImplementedError, type OmniProvider } from "../ai-provider.interface";

/**
 * Shared implementation for every Phase 4 Step 1 stub provider
 * descriptor (Gemini, OpenAI, Anthropic). A stub descriptor declares
 * real, static metadata (id, capabilities, its models, whether its API
 * key env var is present) but never calls a vendor SDK or makes a
 * network request — every execution method throws the shared
 * `notImplementedError()`.
 *
 * Extracted here (rather than duplicated three times) because all
 * three adapters differ only in their metadata and their configured
 * models — the "is this ready, refuse to execute" behavior is
 * identical and must stay identical, so only one place can drift.
 */
export abstract class StubProviderDescriptor implements OmniProvider {
  abstract readonly providerId: ProviderId;
  abstract readonly displayName: string;
  abstract readonly capabilities: readonly ProviderCapability[];
  abstract readonly priority: number;

  protected abstract readonly models: readonly ModelMetadata[];

  /** Whether the vendor API key this descriptor represents is present. Never logs or exposes the key value itself. */
  protected abstract hasCredential(): boolean;

  configStatus(): ProviderConfigStatus {
    return this.hasCredential() ? "configured" : "not-configured";
  }

  isReady(): boolean {
    return this.configStatus() === "configured";
  }

  listModels(): readonly ModelMetadata[] {
    return this.models;
  }

  /**
   * A metadata-only stub never has a real execution path for any
   * capability — every execution method below just throws
   * `NOT_IMPLEMENTED`. Always `false`, regardless of `capability` or of
   * whether `hasCredential()`/`isReady()` currently say the provider is
   * configured. This is what stops `ModelSelectorService` from ever
   * routing a request to a stub provider just because a caller happens
   * to have set its API key env var.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  supportsExecution(_capability: ModelCapability): boolean {
    return false;
  }

  // `async` (rather than a plain function that throws) so callers always
  // get a rejected promise, matching the `OmniProvider` interface's
  // `Promise<...>` return types exactly — never a synchronous throw.
  // Full parameter lists are kept (rather than trimmed to just
  // `modelId`) so every concrete adapter's own call signature matches
  // `OmniProvider` exactly, not just structurally through the interface.
  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async generateText(modelId: ModelId, _prompt: string): Promise<string> {
    throw notImplementedError(this.providerId, modelId);
  }

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async generateStructured(modelId: ModelId, _prompt: string, _schemaName: string): Promise<unknown> {
    throw notImplementedError(this.providerId, modelId);
  }

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async embed(modelId: ModelId, _input: string): Promise<readonly number[]> {
    throw notImplementedError(this.providerId, modelId);
  }
}
