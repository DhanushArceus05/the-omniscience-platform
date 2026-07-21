import { Injectable } from "@nestjs/common";
import type { ModelCapability, ModelId, ModelMetadata, ProviderId } from "@omniscience/types";
import { aiDomainError, hasCapability } from "./ai-provider.interface";

/** `"providerId::modelId"` — a model id is only unique *within* its provider, so the catalog key must include both. */
function catalogKey(providerId: ProviderId, modelId: ModelId): string {
  return `${providerId}::${modelId}`;
}

/**
 * In-memory catalog of every model any registered provider exposes
 * (Phase 4 Step 1). Deliberately not database-backed: the roadmap docs
 * for this step don't require persistence, and re-deriving the catalog
 * from each `OmniProvider.listModels()` at bootstrap keeps it from ever
 * drifting out of sync with what a provider actually reports.
 *
 * Populated once at bootstrap by `AiProviderSeedService`.
 */
@Injectable()
export class ModelCatalogService {
  private readonly models = new Map<string, ModelMetadata>();

  /** Registers one model. Throws `DUPLICATE_MODEL` if `(providerId, modelId)` is already registered. */
  register(model: ModelMetadata): void {
    const key = catalogKey(model.providerId, model.modelId);
    if (this.models.has(key)) {
      throw aiDomainError(
        "DUPLICATE_MODEL",
        `Model "${model.modelId}" is already registered for provider "${model.providerId}".`,
      );
    }
    this.models.set(key, model);
  }

  /** Returns one model's metadata, or throws `MODEL_NOT_FOUND`. */
  getOne(providerId: ProviderId, modelId: ModelId): ModelMetadata {
    const model = this.models.get(catalogKey(providerId, modelId));
    if (!model) {
      throw aiDomainError(
        "MODEL_NOT_FOUND",
        `No model "${modelId}" is registered for provider "${providerId}".`,
      );
    }
    return model;
  }

  /** Every registered model, in registration order. */
  list(): readonly ModelMetadata[] {
    return Array.from(this.models.values());
  }

  /** Every registered model belonging to `providerId`. */
  listByProvider(providerId: ProviderId): readonly ModelMetadata[] {
    return this.list().filter((model) => model.providerId === providerId);
  }

  /** Models that declare support for every capability in `capabilities`. */
  filterByCapabilities(capabilities: readonly ModelCapability[]): readonly ModelMetadata[] {
    return this.list().filter((model) =>
      capabilities.every((capability) => hasCapability(model.capabilities, capability)),
    );
  }
}
