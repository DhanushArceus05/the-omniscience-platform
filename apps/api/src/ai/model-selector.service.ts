import { Injectable } from "@nestjs/common";
import type { ModelMetadata, ModelSelectionRequest, ModelSelectionResult } from "@omniscience/types";
import { aiDomainError, hasCapability } from "./ai-provider.interface";
import { ModelCatalogService } from "./model-catalog.service";
import { ProviderRegistryService } from "./provider-registry.service";

/**
 * Deterministic model-selection foundation (Phase 4 Step 1).
 *
 * Selection depends only on metadata already present in the catalog and
 * registry — required capabilities, model/provider availability and
 * readiness, an optional preferred provider, an optional preferred
 * model, and each candidate's `priority` — never on a vendor name
 * hardcoded here. Cost/latency/context-window metadata is read from
 * `ModelMetadata` when present but does not affect this step's
 * algorithm (there is no policy yet for weighing them against
 * priority); a future phase can extend the tiebreak without changing
 * this service's public contract.
 *
 * Algorithm (in order — the first rule that produces at least one
 * eligible candidate wins; ties within a rule are broken by lowest
 * `priority`, then by catalog registration order):
 *
 *   1. **preferred-model** — `request.preferredModelId` is set. Eligible
 *      candidates are models with that exact `modelId`, additionally
 *      scoped to `request.preferredProviderId` when that is also set.
 *   2. **preferred-provider** — no preferred-model match (or none
 *      requested), but `request.preferredProviderId` is set. Eligible
 *      candidates are every model belonging to that provider.
 *   3. **priority-fallback** — neither preference is set (or neither
 *      matched). Eligible candidates are every model in the catalog.
 *
 * At every rule, a candidate is only eligible if it satisfies all of:
 *   - every capability in `request.requiredCapabilities`
 *   - `model.availability === "available"`
 *   - its provider is currently ready (`OmniProvider.isReady()`)
 *   - its provider genuinely has a real execution path for every
 *     required capability (`OmniProvider.supportsExecution()`, Phase 4
 *     Step 3) — a configured API key is not enough on its own: a
 *     metadata-only stub provider (e.g. Gemini/OpenAI before their own
 *     real adapters exist) can be `isReady() === true` yet still
 *     correctly excluded here, so it can never be selected only to
 *     fail with `NOT_IMPLEMENTED` once `AiService` calls
 *     `generateText`.
 *
 * If no rule produces an eligible candidate, throws `NO_COMPATIBLE_MODEL`.
 */
@Injectable()
export class ModelSelectorService {
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly registry: ProviderRegistryService,
  ) {}

  select(request: ModelSelectionRequest): ModelSelectionResult {
    const eligible = this.catalog
      .list()
      .filter((model) => this.isEligible(model, request.requiredCapabilities));

    if (request.preferredModelId !== undefined) {
      const candidates = eligible.filter(
        (model) =>
          model.modelId === request.preferredModelId &&
          (request.preferredProviderId === undefined ||
            model.providerId === request.preferredProviderId),
      );
      const best = pickHighestPriority(candidates);
      if (best) {
        return { model: best, matchedRule: "preferred-model" };
      }
    }

    if (request.preferredProviderId !== undefined) {
      const candidates = eligible.filter((model) => model.providerId === request.preferredProviderId);
      const best = pickHighestPriority(candidates);
      if (best) {
        return { model: best, matchedRule: "preferred-provider" };
      }
    }

    const best = pickHighestPriority(eligible);
    if (best) {
      return { model: best, matchedRule: "priority-fallback" };
    }

    throw aiDomainError(
      "NO_COMPATIBLE_MODEL",
      "No registered, available model satisfies the requested capabilities and preferences.",
    );
  }

  private isEligible(model: ModelMetadata, requiredCapabilities: ModelSelectionRequest["requiredCapabilities"]): boolean {
    if (model.availability !== "available") {
      return false;
    }
    if (!requiredCapabilities.every((capability) => hasCapability(model.capabilities, capability))) {
      return false;
    }
    // A provider that isn't ready (e.g. missing credentials) can never
    // yield a usable model, regardless of what the model's own static
    // `availability` metadata says.
    const provider = this.registry.list().find((candidate) => candidate.providerId === model.providerId);
    if (provider === undefined || !provider.isReady()) {
      return false;
    }
    // Nor can a provider that is ready-by-configuration but has no
    // genuine execution implementation for one of the required
    // capabilities — see the class doc comment's execution-eligibility
    // note above.
    return requiredCapabilities.every((capability) => provider.supportsExecution(capability));
  }
}

/** Lowest `priority` number wins; ties keep the first-encountered (registration order) candidate. */
function pickHighestPriority(candidates: readonly ModelMetadata[]): ModelMetadata | undefined {
  return candidates.reduce<ModelMetadata | undefined>((best, candidate) => {
    if (!best || candidate.priority < best.priority) {
      return candidate;
    }
    return best;
  }, undefined);
}
