import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  CapabilityPlan,
  ModelCapability,
  ResolvedOmniCoreIntent,
  TaskPlan,
  TaskPlanStep,
} from "@omniscience/types";
import { ComplexityEstimatorService } from "./complexity-estimator.service";
import { ExecutionStageBuilderService } from "./execution-stage-builder.service";
import { PlanValidatorService } from "./plan-validator.service";

/**
 * A short, human-readable title per `ResolvedOmniCoreIntent`, used to
 * fill in a `TaskPlanStep`'s `title`/`objective` — the same per-intent
 * seam `CapabilityPlanBuilderService.INTENT_CAPABILITY_MAP` already
 * established for capability selection, reused here for descriptive
 * text instead. Extending this map is the only change a future intent
 * needs to plug into task planning's descriptive fields.
 */
const INTENT_STEP_TITLE: Readonly<Record<ResolvedOmniCoreIntent, string>> = {
  "simple-generation": "Generate a response",
  "question-answering": "Answer the question",
  "code-generation": "Generate code",
  summarization: "Summarize the input",
  "creative-writing": "Write creative content",
};

const INTENT_STEP_OBJECTIVE: Readonly<Record<ResolvedOmniCoreIntent, string>> = {
  "simple-generation": "Produce a direct response to the user's prompt.",
  "question-answering": "Answer the user's question accurately and completely.",
  "code-generation": "Produce working code that satisfies the user's request.",
  summarization: "Condense the user's input into a concise summary.",
  "creative-writing": "Produce original creative writing matching the user's request.",
};

const INTENT_STEP_EXPECTED_OUTPUT: Readonly<Record<ResolvedOmniCoreIntent, string>> = {
  "simple-generation": "Generated text responding to the prompt.",
  "question-answering": "An answer to the user's question.",
  "code-generation": "Source code satisfying the request.",
  summarization: "A concise summary of the input.",
  "creative-writing": "A piece of creative writing matching the request.",
};

/**
 * Builds a `TaskPlan` from a `CapabilityPlan` (Phase 5 Step 3). This is
 * the seam requirement 7 ("Planner architecture") describes as the
 * planner "reusing and improving the current capability-plan-builder
 * rather than duplicating logic": `TaskPlannerService` never decides
 * which `ModelCapability` a request needs on its own — that remains
 * `CapabilityPlanBuilderService.build()`'s job entirely, including its
 * `AMBIGUOUS_INTENT` refusal, which callers still go through exactly
 * as before Step 3. `TaskPlannerService.plan()` takes the resulting
 * `CapabilityPlan` and enriches each of its steps into the fuller
 * `TaskPlanStep` shape, then validates and stages the result.
 *
 * Every resolved intent still compiles to exactly one
 * `CapabilityPlanStep` today, so `plan()` always produces a
 * single-step, single-stage `TaskPlan` in practice — the multi-step
 * case (dependency ordering across more than one real step) is
 * exercised directly against `DependencyGraphService`/
 * `ExecutionStageBuilderService`/`ComplexityEstimatorService` in this
 * module's own tests, using hand-built `TaskPlanStep[]` fixtures,
 * since no real intent decomposes into more than one step yet. Real
 * multi-step decomposition (e.g. a `code-generation` pipeline of
 * "design → implement → test" steps) and actually executing a
 * `TaskPlan`'s stages are both explicitly out of scope — the former
 * is a `CapabilityPlanBuilderService` extension, the latter is Phase
 * 5 Step 4 orchestration.
 */
@Injectable()
export class TaskPlannerService {
  constructor(
    private readonly stageBuilder: ExecutionStageBuilderService,
    private readonly complexityEstimator: ComplexityEstimatorService,
    private readonly validator: PlanValidatorService,
  ) {}

  /**
   * Builds a `TaskPlan` from an already-resolved `CapabilityPlan`.
   * Never called for an ambiguous match — `capabilityPlan` is only
   * ever a `CapabilityPlan` `CapabilityPlanBuilderService.build()`
   * itself returned, and that method already refuses to build one for
   * an `"ambiguous"` `FastRuleMatch`.
   */
  plan(capabilityPlan: CapabilityPlan): TaskPlan {
    const draftSteps = capabilityPlan.steps.map((step) =>
      this.toDraftStep(capabilityPlan.intent, step.stepId, step.capability, step.input),
    );

    this.validator.validateSteps(draftSteps);

    const { stages, steps } = this.stageBuilder.build(draftSteps);
    const complexity = this.complexityEstimator.estimateTask(steps, stages);

    return {
      taskPlanId: randomUUID(),
      sourceCapabilityPlanId: capabilityPlan.planId,
      intent: capabilityPlan.intent,
      steps,
      stages,
      complexity,
    };
  }

  private toDraftStep(
    intent: ResolvedOmniCoreIntent,
    stepId: string,
    capability: ModelCapability,
    input: string,
  ): TaskPlanStep {
    const capabilities: readonly ModelCapability[] = [capability];
    return {
      stepId,
      title: INTENT_STEP_TITLE[intent],
      description: `${INTENT_STEP_TITLE[intent]} for the given prompt using the ${capability} capability.`,
      objective: INTENT_STEP_OBJECTIVE[intent],
      capabilities,
      inputRequirements: input,
      expectedOutput: INTENT_STEP_EXPECTED_OUTPUT[intent],
      dependsOn: [],
      // Placeholder until `ExecutionStageBuilderService.build()` sets
      // the real value derived from the dependency graph — always a
      // single-step, single-stage plan today, so this is always
      // overwritten with `"sequential"` in practice.
      executionMode: "sequential",
      complexity: this.complexityEstimator.estimateStep({ capabilities, dependsOn: [] }),
      failurePolicy: { mode: "abort" },
    };
  }
}
