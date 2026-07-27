import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { CapabilityPlan, FastRuleMatch, ModelCapability, ResolvedOmniCoreIntent } from "@omniscience/types";
import { omniCoreDomainError } from "./omnicore.errors";

/**
 * The `ModelCapability` each resolved intent requires, looked up by
 * `build()` instead of a hardcoded literal — this is the "capability
 * selection based on detected intent" piece of Phase 5 Step 2. Every
 * entry maps to `"text-generation"` today because that remains the
 * *only* capability any registered `OmniProvider` adapter genuinely
 * executes (see `AnthropicProvider`/`GeminiProvider`'s
 * `supportsExecution()` — `ModelSelectorService` excludes a candidate
 * model whose provider can't really execute a required capability, so
 * requesting e.g. `"structured-output"` here would only ever produce
 * `NO_COMPATIBLE_MODEL`, never a working plan). The map exists as a
 * real per-intent seam precisely so that changes: once a specialized
 * module or provider adapter genuinely implements a second capability,
 * routing `"code-generation"` or `"summarization"` to it is a one-line
 * change here, not a change to this method's logic.
 */
const INTENT_CAPABILITY_MAP: Readonly<Record<ResolvedOmniCoreIntent, ModelCapability>> = {
  "simple-generation": "text-generation",
  "question-answering": "text-generation",
  "code-generation": "text-generation",
  summarization: "text-generation",
  "creative-writing": "text-generation",
};

/**
 * Compiles a matched intent into a `CapabilityPlan` — the "capability
 * plan" step in `docs/04_System_Architecture.md`'s flow (`User →
 * Assistant → OmniCore → capability plan → OmniProvider/Model Manager
 * → ...`).
 *
 * `build()` refuses to plan for an `"ambiguous"` match — an ambiguous
 * request is something OmniCore should ask about, not guess a plan
 * for (Phase 5 Step 2). This is the single place that rule is
 * enforced: neither `OmniCoreService` nor `FastRulesEngineService`
 * need their own copy of the check, since every path from
 * classification to execution passes through here.
 *
 * For every resolved intent, `build()` produces a single
 * `INTENT_CAPABILITY_MAP[intent]` step whose input is the original
 * prompt verbatim. Every plan and step gets a fresh random id, never
 * derived from request content, so plans stay individually traceable
 * in logs without leaking prompt content into an id. Multi-step plans
 * for genuinely complex tasks are the Phase 5 Step 3 "complex-task
 * planner / pipeline builder" work — this service is deliberately the
 * seam that step extends, not replaces: its public `build()` signature
 * and the plural `CapabilityPlan.steps` shape already support more
 * than one step without a breaking change.
 */
@Injectable()
export class CapabilityPlanBuilderService {
  build(prompt: string, match: FastRuleMatch): CapabilityPlan {
    const { intent } = match;
    if (!isResolvedIntent(intent)) {
      throw omniCoreDomainError(
        "AMBIGUOUS_INTENT",
        "The request is ambiguous between multiple intents; a capability plan cannot be built until it's resolved.",
        { alternateIntents: match.alternateIntents ?? [] },
      );
    }

    return {
      planId: randomUUID(),
      intent,
      steps: [
        {
          stepId: randomUUID(),
          capability: INTENT_CAPABILITY_MAP[intent],
          input: prompt,
        },
      ],
    };
  }
}

function isResolvedIntent(intent: FastRuleMatch["intent"]): intent is ResolvedOmniCoreIntent {
  return intent !== "ambiguous";
}
