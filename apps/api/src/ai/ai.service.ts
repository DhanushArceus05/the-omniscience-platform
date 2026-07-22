import { Injectable } from "@nestjs/common";
import type { GenerateTextResponse } from "@omniscience/types";
import { ModelSelectorService } from "./model-selector.service";
import { ProviderRegistryService } from "./provider-registry.service";

/**
 * Thin, vendor-neutral orchestration for `POST /ai/generate` (Phase 4
 * Step 3): `AiService.generate()` → `ModelSelectorService.select()` →
 * `ProviderRegistryService` provider lookup → `OmniProvider.generateText()`.
 *
 * This is the only place `AiController` reaches into the `ai` module's
 * internals — it never touches `ModelSelectorService`/
 * `ProviderRegistryService`/a concrete provider directly. Nothing here
 * branches on a provider id, a model id, or any vendor-specific
 * behavior: `requiredCapabilities` is the one fixed, internal value
 * (`["text-generation"]`), and everything else — which provider, which
 * model, whether it's genuinely executable right now — is decided by
 * `ModelSelectorService`'s capability/availability/readiness/execution-
 * eligibility algorithm.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly selector: ModelSelectorService,
    private readonly registry: ProviderRegistryService,
  ) {}

  /**
   * Selects the best eligible model for plain text generation and
   * executes it. Every failure mode — no compatible model, a provider
   * whose credentials disappeared between selection and execution, a
   * mapped vendor error — propagates unchanged as the same normalized
   * `AiDomainErrorCode` the underlying service/provider already threw;
   * this method adds no additional try/catch of its own.
   */
  async generate(prompt: string): Promise<GenerateTextResponse> {
    const { model } = this.selector.select({ requiredCapabilities: ["text-generation"] });
    const provider = this.registry.getById(model.providerId);
    const text = await provider.generateText(model.modelId, prompt);
    return { text, providerId: model.providerId, modelId: model.modelId };
  }
}
