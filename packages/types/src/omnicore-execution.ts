/**
 * OmniCore execution orchestration (Phase 5 Step 4).
 *
 * Step 3 (`omnicore-plan.ts`) produced a `TaskPlan` — a validated,
 * dependency-ordered, execution-*ready* description of work — but
 * never ran anything. Step 4 is the layer that actually runs it:
 * `ExecutionOrchestratorService` walks a `TaskPlan`'s `stages` in
 * order, `StepExecutorService` runs each individual `TaskPlanStep`
 * through the existing provider path, and the types below are the
 * strongly typed record of what happened — one `StepExecutionResult`
 * per step, rolled up into one `StageExecutionResult` per stage,
 * rolled up into one `PlanExecutionResult` for the whole `TaskPlan`.
 *
 * `PlanExecutionResult` is attached to `OmniCoreExecuteResponse` as
 * `execution` (see `omnicore.ts`) — purely additively, alongside the
 * `taskPlan` Step 3 already added. Nothing from Step 1/2/3 changes
 * meaning or shape.
 *
 * Only `"abort"` failure policy is implemented this phase (see
 * `StepFailurePolicy` in `omnicore-plan.ts`): the orchestrator stops
 * the whole plan and lets the underlying error propagate unchanged
 * the moment any step fails, times out, or is cancelled, exactly like
 * `OmniCoreService.execute()` already did before this phase for its
 * single hard-coded step. `"completed"` is consequently the only
 * status a *returned* `PlanExecutionResult`/`StageExecutionResult`
 * will ever carry in this phase — a failure is a thrown, typed domain
 * error (see `apps/api/src/omnicore/omnicore.errors.ts`), not a result
 * value with `status: "failed"`. `"failed"`, `"skipped"`, and
 * `"cancelled"` are still part of this type today, not speculative
 * future additions: they are what a `"continue"`/`"retry"` failure
 * policy (deferred to a future phase) would need to *return* a
 * partial result instead of throwing, and `ExecutionOrchestratorService`
 * already builds these values internally for structured logging
 * before it re-throws — see that service's doc comment.
 */

import type { ModelId, ProviderId } from "./ai-provider";

/**
 * The lifecycle status of a plan, stage, or step's execution.
 * `"pending"` — not yet started. `"running"` — in progress.
 * `"completed"` — finished successfully. `"failed"` — finished with an
 * error. `"skipped"` — never attempted because a prerequisite didn't
 * complete (reserved for a future non-`"abort"` failure policy).
 * `"cancelled"` — stopped in response to an external cancellation
 * signal or a timeout.
 */
export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled";

/**
 * The outcome of running one `TaskPlanStep`. `output` is only present
 * for `status: "completed"`; `errorCode` (an `OmniCoreDomainErrorCode`
 * or an `AiDomainErrorCode` string, kept as a plain `string` here so
 * this type doesn't need to depend on either) is only present for
 * `status: "failed"`. `providerId`/`modelId` record which model
 * actually executed the step, typed precisely (not a plain `string`)
 * so `OmniCoreService` can read `providerId`/`modelId` straight off a
 * `StepExecutionResult` into `OmniCoreExecuteResponse` without a cast
 * — the same "no vendor name in the response by construction, only
 * through this typed field" reasoning `OmniCoreExecuteResponse`
 * already follows.
 *
 * `toolId` (Phase 5 Step 5) is the tool-routed counterpart to
 * `providerId`/`modelId`: set instead of them when this step ran
 * through `ToolExecutorService` (`TaskPlanStep.toolCategory` was set)
 * rather than through a model provider. A given `StepExecutionResult`
 * only ever has one or the other populated, never both.
 */
export interface StepExecutionResult {
  readonly stepId: string;
  readonly status: ExecutionStatus;
  readonly output?: string;
  readonly errorCode?: string;
  readonly providerId?: ProviderId;
  readonly modelId?: ModelId;
  readonly toolId?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
}

/** The outcome of running one `ExecutionStage` — every step it contains, in the order they were attempted. */
export interface StageExecutionResult {
  readonly stageId: string;
  readonly status: ExecutionStatus;
  readonly stepResults: readonly StepExecutionResult[];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
}

/** The outcome of running an entire `TaskPlan` — every stage it contains, in execution order. */
export interface PlanExecutionResult {
  readonly taskPlanId: string;
  readonly status: ExecutionStatus;
  readonly stageResults: readonly StageExecutionResult[];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
}
