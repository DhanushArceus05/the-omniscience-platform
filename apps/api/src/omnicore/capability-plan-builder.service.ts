import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { CapabilityPlan, FastRuleMatch } from "@omniscience/types";

/**
 * Compiles a matched intent into a `CapabilityPlan` — the "capability
 * plan" step in `docs/04_System_Architecture.md`'s flow (`User →
 * Assistant → OmniCore → capability plan → OmniProvider/Model Manager
 * → ...`).
 *
 * Step 1 recognizes only the `"simple-generation"` intent
 * (`FastRulesEngineService`'s only output), so `build()` always
 * produces a single `"text-generation"` step whose input is the
 * original prompt verbatim. Every plan and step gets a fresh random
 * id, never derived from request content, so plans are always
 * individually traceable in logs without leaking prompt content into
 * an id. Multi-step plans for genuinely complex tasks are the Phase 5
 * Step 3 "complex-task planner / pipeline builder" work — this service
 * is deliberately the seam that step extends, not replaces: its public
 * `build()` signature and the plural `CapabilityPlan.steps` shape
 * already support more than one step without a breaking change.
 */
@Injectable()
export class CapabilityPlanBuilderService {
  build(prompt: string, match: FastRuleMatch): CapabilityPlan {
    return {
      planId: randomUUID(),
      intent: match.intent,
      steps: [
        {
          stepId: randomUUID(),
          capability: "text-generation",
          input: prompt,
        },
      ],
    };
  }
}
