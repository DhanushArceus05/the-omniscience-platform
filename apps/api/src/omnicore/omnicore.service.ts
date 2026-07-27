import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import type { OmniCoreExecuteResponse } from "@omniscience/types";
import { ModelSelectorService } from "../ai/model-selector.service";
import { ProviderRegistryService } from "../ai/provider-registry.service";
import { LOGGER } from "../config/config.constants";
import { CapabilityPlanBuilderService } from "./capability-plan-builder.service";
import { FastRulesEngineService } from "./fast-rules-engine.service";
import { omniCoreDomainError } from "./omnicore.errors";

/**
 * `OmniCoreService` — OmniCore's orchestration entry point (Phase 5
 * Steps 1-2), implementing the first slice of
 * `docs/04_System_Architecture.md`'s flow: `User → Assistant →
 * OmniCore → capability plan → OmniProvider/Model Manager → ...`.
 * ("Assistant" here is the future Phase 6 Omniscience Assistant
 * conversation layer; `POST /omnicore/execute`, the same shape as
 * Phase 4's `POST /ai/generate`, stands in for it as a diagnostic
 * entry point until that phase exists.)
 *
 * `execute()`:
 *   1. Classifies the prompt via `FastRulesEngineService` ("fast
 *      rules" / Step 2's intent intelligence) — this can now return
 *      any of five concrete intents, or the synthetic `"ambiguous"`
 *      intent when classification is genuinely uncertain.
 *   2. Compiles the match into a `CapabilityPlan` via
 *      `CapabilityPlanBuilderService` ("capability plan").
 *   3. Executes the plan's one step by requesting a model selection
 *      from `ModelSelectorService` (never a vendor name — the
 *      Provider Rule) and invoking the resulting `OmniProvider`
 *      directly ("OmniProvider/Model Manager").
 *
 * Notably, this method contains no `"ambiguous"`-specific branch of
 * its own: `CapabilityPlanBuilderService.build()` is the single place
 * that refuses to plan for an ambiguous match, throwing
 * `AMBIGUOUS_INTENT`. That error propagates out of step 2 exactly
 * like every other domain error already documented below — this
 * method still adds no additional try/catch of its own, for
 * ambiguity or anything else.
 *
 * Deliberately depends on `ModelSelectorService`/`ProviderRegistryService`
 * directly rather than on `AiService` (`apps/api/src/ai/ai.service.ts`):
 * `AiService` is `AiModule`'s own internal implementation detail for
 * `POST /ai/generate` and is not exported, while `ModelSelectorService`/
 * `ProviderRegistryService` are exported from `AiModule` specifically
 * so a consumer like this one "can request a model selection without
 * re-implementing the algorithm" (see `ai.module.ts`'s doc comment).
 * OmniCore is the intended long-term caller of that seam, not a
 * second, parallel copy of `AiService.generate()`'s three-line body.
 *
 * "Validation and fallback" (the rest of `docs/06_AI_Architecture.md`'s
 * OmniCore line) remain future work: there is still no output
 * validator/reviewer and no fallback across models/providers on
 * failure — every error from the selector, registry, or provider
 * propagates unchanged, exactly like `AiService.generate()` today.
 * "Confidence" is real as of Step 2 (the fast-rules match's score,
 * used to detect ambiguity), but it is not yet used to validate or
 * second-guess a successful generation's *output*. Real output
 * validation and fallback are Phase 5 Step 4/5 work.
 */
@Injectable()
export class OmniCoreService {
  constructor(
    private readonly fastRules: FastRulesEngineService,
    private readonly planBuilder: CapabilityPlanBuilderService,
    private readonly selector: ModelSelectorService,
    private readonly registry: ProviderRegistryService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Classifies, plans, and executes `prompt` end to end. Every failure
   * mode — an unrecognized intent, an ambiguous one (`AMBIGUOUS_INTENT`,
   * thrown by `CapabilityPlanBuilderService.build()`), no compatible
   * model, a provider whose credentials disappeared between selection
   * and execution, a mapped vendor error — propagates unchanged as the
   * same normalized domain error the underlying service/provider
   * already threw; this method adds no additional try/catch of its
   * own (same invariant `AiService.generate()` documents).
   */
  async execute(prompt: string): Promise<OmniCoreExecuteResponse> {
    const match = this.fastRules.classify(prompt);
    const plan = this.planBuilder.build(prompt, match);

    const [step, ...rest] = plan.steps;
    if (!step || rest.length > 0) {
      // Defensive guard: `CapabilityPlanBuilderService` only ever
      // produces exactly one step in Step 1. Multi-step execution
      // arrives with the Phase 5 Step 3/4 planner and execution
      // manager — this method must not silently execute only the
      // first step of a plan it doesn't yet know how to run in full.
      throw omniCoreDomainError(
        "INTENT_NOT_RECOGNIZED",
        "OmniCore Step 1 supports only single-step capability plans.",
      );
    }

    const { model, matchedRule } = this.selector.select({ requiredCapabilities: [step.capability] });
    const provider = this.registry.getById(model.providerId);
    const text = await provider.generateText(model.modelId, step.input);

    this.logger.debug(
      {
        planId: plan.planId,
        intent: plan.intent,
        matchedRuleId: match.ruleId,
        confidence: match.confidence,
        providerId: model.providerId,
        modelId: model.modelId,
        matchedSelectorRule: matchedRule,
      },
      "omnicore: executed capability plan",
    );

    return {
      planId: plan.planId,
      intent: plan.intent,
      matchedRuleId: match.ruleId,
      confidence: match.confidence,
      text,
      providerId: model.providerId,
      modelId: model.modelId,
    };
  }
}
