/**
 * OmniCore task planning (Phase 5 Step 3).
 *
 * Step 1/2 (`omnicore.ts`) already established `CapabilityPlan` —
 * "which `ModelCapability` does this request need, and with what
 * input" — as the seam `CapabilityPlanBuilderService` compiles a
 * resolved intent into. Step 3 ("production-grade task planning
 * engine") sits on top of that seam rather than replacing it: a
 * `TaskPlan` is built *from* a `CapabilityPlan` (see
 * `TaskPlannerService`), enriching each `CapabilityPlanStep` into a
 * `TaskPlanStep` with the richer, execution-ready fields a real
 * orchestrator (Phase 5 Step 4) will need — a title/description/
 * objective a human or reviewer can read, explicit `dependsOn`
 * references, an `executionMode`, a per-step `complexity`, and
 * `failurePolicy` guidance — plus a dependency-validated,
 * topologically ordered set of `stages` describing which steps may
 * run in parallel and which must run sequentially.
 *
 * Every resolved intent still compiles to exactly one
 * `CapabilityPlanStep` today (Step 2's classifier is single-shot), so
 * every `TaskPlan` OmniCore actually produces end to end is currently
 * a single-step, single-stage plan. Nothing here assumes that,
 * though: `steps`/`stages` are already the plural, dependency-aware
 * shape a future multi-step decomposition (e.g. a real
 * `code-generation` pipeline of "design → implement → test" steps)
 * will populate without a breaking change to this file's exports —
 * the same "plural shape precedes the builder that fills it"
 * precedent `CapabilityPlan.steps` set in Step 1. `DependencyGraphService`,
 * `PlanValidatorService`, `ComplexityEstimatorService`, and
 * `ExecutionStageBuilderService` are exercised directly against
 * hand-built multi-step fixtures in their own unit tests for exactly
 * this reason — the engine is general even though today's only
 * producer of a `TaskPlan` is not.
 *
 * Actual orchestration — executing steps/stages in the order this
 * file describes, retrying per `failurePolicy`, running a parallel
 * stage's steps concurrently — is explicitly out of scope; see
 * `TaskPlannerService`'s doc comment for what's deferred to Phase 5
 * Step 4.
 */

import type { ModelCapability } from "./ai-provider";
import type { ResolvedOmniCoreIntent } from "./omnicore";

/**
 * How much a step or an overall `TaskPlan` is estimated to cost to
 * execute correctly — not wall-clock time, but a coarse-grained signal
 * a future scheduler/UI can use to set expectations, timeouts, or
 * review requirements. See `ComplexityEstimatorService` for the model
 * behind this classification.
 */
export type TaskComplexity = "low" | "medium" | "high" | "very-high";

/**
 * Whether a step is scheduled to run on its own (`"sequential"`) or
 * alongside other steps in the same `ExecutionStage` (`"parallel"`).
 * Set by `ExecutionStageBuilderService` from the dependency graph, not
 * chosen freely per step: a step with any unresolved dependency in its
 * own stage is a validation bug, never a valid `TaskPlan`.
 */
export type StepExecutionMode = "sequential" | "parallel";

/**
 * Guidance for how an orchestrator (Phase 5 Step 4) should react if a
 * step fails at execution time. `"abort"` stops the whole plan;
 * `"retry"` is meant to be re-attempted up to `maxAttempts` times;
 * `"skip"` allows dependents to proceed anyway (only sound for a step
 * whose output nothing downstream strictly requires). Planning-only
 * today — nothing in this phase actually retries or skips anything.
 */
export interface StepFailurePolicy {
  readonly mode: "abort" | "retry" | "skip";
  /** Only meaningful when `mode` is `"retry"`; omitted otherwise. */
  readonly maxAttempts?: number;
}

/**
 * One execution-ready unit of work in a `TaskPlan`. A superset of
 * `CapabilityPlanStep`: `stepId`, `capability` (as `capabilities[0]`,
 * see below), and `input` (as `inputRequirements`) all trace directly
 * back to the `CapabilityPlanStep` this step was built from —
 * `TaskPlannerService` never invents a capability the underlying
 * `CapabilityPlan` didn't already require.
 */
export interface TaskPlanStep {
  readonly stepId: string;
  readonly title: string;
  readonly description: string;
  /** What this step is meant to accomplish, in one sentence — distinct from `description`'s "what it does". */
  readonly objective: string;
  /**
   * Every `ModelCapability` this step requires. Almost always a single
   * entry today (one `CapabilityPlanStep` maps to one capability), but
   * plural because a genuinely composite step (e.g. "generate and
   * validate structured output") may legitimately require more than
   * one — the same rationale `ModelSelectionRequest.requiredCapabilities`
   * already uses.
   */
  readonly capabilities: readonly ModelCapability[];
  /**
   * A free-form category for a non-capability tool this step needs
   * (e.g. `"file-system"`, `"web-search"`, `"code-execution"`).
   * Omitted for steps that only need a model capability and no
   * external tool — which, per `CapabilityPlanBuilderService`'s
   * current `INTENT_CAPABILITY_MAP`, is every step today.
   */
  readonly toolCategory?: string;
  /** What this step needs as input to run — today, always the source `CapabilityPlanStep.input` verbatim. */
  readonly inputRequirements: string;
  /** A human-readable description of what successfully completing this step produces. */
  readonly expectedOutput: string;
  /** `stepId`s of every step that must complete before this one may start. Empty for a step with no prerequisites. */
  readonly dependsOn: readonly string[];
  readonly executionMode: StepExecutionMode;
  readonly complexity: TaskComplexity;
  readonly failurePolicy: StepFailurePolicy;
}

/**
 * One group of steps `ExecutionStageBuilderService` has determined may
 * be attempted together, in the topological order stages appear in
 * `TaskPlan.stages`. `mode` is `"parallel"` only when `stepIds` has
 * more than one entry *and* none of them depends on another step in
 * the same stage (guaranteed by construction — see that service's
 * doc comment); a single-step stage is always `"sequential"`.
 */
export interface ExecutionStage {
  readonly stageId: string;
  readonly mode: StepExecutionMode;
  readonly stepIds: readonly string[];
}

/**
 * The Phase 5 Step 3 planning output: a validated, dependency-ordered,
 * execution-ready expansion of a `CapabilityPlan`. `taskPlanId` is
 * distinct from `sourceCapabilityPlanId` (the `CapabilityPlan.planId`
 * this was built from) so both remain independently traceable in
 * logs; `intent` is copied straight through from that `CapabilityPlan`
 * since a `TaskPlan` never changes what a request was classified as,
 * only how its execution is structured.
 */
export interface TaskPlan {
  readonly taskPlanId: string;
  readonly sourceCapabilityPlanId: string;
  readonly intent: ResolvedOmniCoreIntent;
  readonly steps: readonly TaskPlanStep[];
  readonly stages: readonly ExecutionStage[];
  readonly complexity: TaskComplexity;
}
