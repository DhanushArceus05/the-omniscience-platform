import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import type { GenerateTextResponse } from "@omniscience/types";
import { LOGGER } from "../config/config.constants";
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
 *
 * Phase 4 Step 5 (production hardening): logs which provider/model was
 * selected, at `debug`, only on success. Deliberately does *not* log on
 * failure — every thrown error already reaches `AllExceptionsFilter`,
 * which logs it centrally (status, normalized code, and stack) for
 * every route in the app; adding a second log line here for the same
 * failure would just double-log every error. This keeps this method's
 * documented "adds no additional try/catch of its own" invariant
 * completely intact — logging happens only after a successful result
 * already exists, with no new control flow around the calls that can
 * throw.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly selector: ModelSelectorService,
    private readonly registry: ProviderRegistryService,
    @Inject(LOGGER) private readonly logger: Logger,
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
    const { model, matchedRule } = this.selector.select({ requiredCapabilities: ["text-generation"] });
    const provider = this.registry.getById(model.providerId);
    const text = await provider.generateText(model.modelId, prompt);
    this.logger.debug(
      { providerId: model.providerId, modelId: model.modelId, matchedRule },
      "ai: generated text",
    );
    return { text, providerId: model.providerId, modelId: model.modelId };
  }
}
