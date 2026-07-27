import { Injectable } from "@nestjs/common";
import type { ModelCapability, TaskPlanStep } from "@omniscience/types";
import { omniCoreDomainError } from "./omnicore.errors";

/**
 * Every `ModelCapability` `CapabilityPlanBuilderService`'s
 * `INTENT_CAPABILITY_MAP` can currently produce. `PlanValidatorService`
 * checks each step's `capabilities` against this set (rather than the
 * full `ModelCapability` union from `@omniscience/types`) so
 * `UNSUPPORTED_CAPABILITY_MAPPING` genuinely means "this step requires
 * a capability no real `CapabilityPlan` maps any intent to today" —
 * not merely "this string isn't a `ModelCapability` at all", which
 * TypeScript itself already guarantees at the type level and would
 * make this check redundant.
 */
const SUPPORTED_TASK_PLAN_CAPABILITIES: ReadonlySet<ModelCapability> = new Set<ModelCapability>([
  "text-generation",
]);

/**
 * Strict schema/runtime validation for a `TaskPlan`'s steps (Phase 5
 * Step 3, requirement 8 "Validation"). Deliberately narrower than
 * `DependencyGraphService`: that service owns every check that's
 * fundamentally about the *shape of the dependency graph*
 * (duplicate ids, missing/circular references); this service owns
 * every check that's about an individual step's or the plan's own
 * *content* instead, and delegates to `DependencyGraphService` for
 * the rest rather than duplicating it.
 */
@Injectable()
export class PlanValidatorService {
  /**
   * Validates `steps` before a `TaskPlan` is built from them. Throws
   * `INVALID_TASK_PLAN` if `steps` is empty or any step has no
   * `capabilities`, and `UNSUPPORTED_CAPABILITY_MAPPING` if any step
   * requires a capability outside `SUPPORTED_TASK_PLAN_CAPABILITIES`.
   * Does not check `dependsOn` at all — that is
   * `DependencyGraphService.layers()`'s job, and `TaskPlannerService`
   * always calls both rather than relying on either alone.
   */
  validateSteps(steps: readonly TaskPlanStep[]): void {
    if (steps.length === 0) {
      throw omniCoreDomainError("INVALID_TASK_PLAN", "A task plan must contain at least one step.");
    }

    const stepsWithNoCapability = steps.filter((step) => step.capabilities.length === 0);
    if (stepsWithNoCapability.length > 0) {
      throw omniCoreDomainError(
        "INVALID_TASK_PLAN",
        "Every task plan step must require at least one capability.",
        { stepIds: stepsWithNoCapability.map((step) => step.stepId) },
      );
    }

    const unsupported = steps.flatMap((step) =>
      step.capabilities
        .filter((capability) => !SUPPORTED_TASK_PLAN_CAPABILITIES.has(capability))
        .map((capability) => ({ stepId: step.stepId, capability })),
    );
    if (unsupported.length > 0) {
      throw omniCoreDomainError(
        "UNSUPPORTED_CAPABILITY_MAPPING",
        "One or more task plan steps require a capability no resolved intent maps to.",
        { unsupported },
      );
    }
  }
}
