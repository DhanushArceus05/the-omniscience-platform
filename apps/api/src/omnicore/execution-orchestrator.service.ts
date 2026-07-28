import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import type {
  PlanExecutionResult,
  StageExecutionResult,
  StepExecutionResult,
  TaskPlan,
  TaskPlanStep,
} from "@omniscience/types";
import { LOGGER } from "../config/config.constants";
import { DependencyGraphService } from "./dependency-graph.service";
import { omniCoreDomainError } from "./omnicore.errors";
import { StepExecutorService } from "./step-executor.service";

/** Options controlling an entire `TaskPlan`'s execution. Both are optional, applied uniformly to every step the orchestrator runs — see `StepExecutorService.execute()` for what each does at the individual-step level. */
export interface PlanExecutionOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Runs a `TaskPlan` to completion (Phase 5 Step 4, requirement 1
 * "Execution Orchestrator"). Walks `taskPlan.stages` in order —
 * `TaskPlan.stages` is already the topologically valid order
 * `ExecutionStageBuilderService` (Step 3) computed, so this method
 * does no ordering work of its own beyond re-validating it (see
 * below). Within a stage, `"sequential"` steps run one at a time in
 * `stage.stepIds` order; `"parallel"` steps run concurrently via
 * `Promise.all` — safe by construction, since
 * `DependencyGraphService.layers()` (Step 3) already guarantees no
 * step in a parallel stage depends on another step in that same
 * stage.
 *
 * **Failure policy.** Only `"abort"` (`StepFailurePolicy.mode`) is
 * implemented this phase, as required: the moment any step fails,
 * times out, or is cancelled, this method stops running further steps
 * and stages and lets that step's original error propagate unchanged
 * — exactly the "every error propagates unchanged, no extra
 * try/catch" invariant `OmniCoreService.execute()` already documented
 * before this phase existed. `PlanExecutionResult`/`StageExecutionResult`
 * consequently only ever come back with `status: "completed"` from a
 * *returned* value in this phase; `"failed"`/`"cancelled"`/`"skipped"`
 * are built internally (for the structured log emitted right before
 * the throw — requirement 9 "Observability") but never reach a
 * caller as a value, only as the thrown error's `code`. A future
 * `"continue"`/`"retry"` policy is the point at which a partial
 * result carrying those statuses would start being *returned* instead
 * of thrown — this method's per-step/per-stage result-building is
 * already structured so that only the "stop on first failure" branch
 * needs to change, not the result-building itself.
 *
 * **Dependencies.** Re-validates `taskPlan.steps` through the same
 * `DependencyGraphService.layers()` Step 3 already uses (requirement
 * 3: "reuse the Step 3 dependency graph and validation architecture")
 * before running anything, and — defensively, since `"abort"` already
 * makes it unreachable in practice — confirms every step's `dependsOn`
 * completed successfully immediately before that step runs, throwing
 * `DEPENDENCY_FAILURE` if not.
 */
@Injectable()
export class ExecutionOrchestratorService {
  constructor(
    private readonly stepExecutor: StepExecutorService,
    private readonly dependencyGraph: DependencyGraphService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async execute(taskPlan: TaskPlan, options: PlanExecutionOptions = {}): Promise<PlanExecutionResult> {
    // Defensive re-validation (requirement 3) — every `TaskPlan` OmniCore
    // itself builds already passed this in `TaskPlannerService`, but the
    // orchestrator does not assume that of whatever `TaskPlan` it's handed.
    this.dependencyGraph.layers(taskPlan.steps);

    const stepsById = new Map(taskPlan.steps.map((step) => [step.stepId, step]));
    const stepResultsById = new Map<string, StepExecutionResult>();
    const stageResults: StageExecutionResult[] = [];
    const planStartedAt = new Date();

    this.logger.debug({ taskPlanId: taskPlan.taskPlanId, stageCount: taskPlan.stages.length }, "omnicore: plan execution starting");

    for (const stage of taskPlan.stages) {
      const stepsInStage = stage.stepIds.map((stepId) => {
        const step = stepsById.get(stepId);
        if (!step) {
          throw omniCoreDomainError(
            "INVALID_EXECUTION_STATE",
            `Stage "${stage.stageId}" references step "${stepId}", which is not present in the plan.`,
            { stageId: stage.stageId, stepId },
          );
        }
        return step;
      });

      const stageStartedAt = new Date();
      this.logger.debug({ taskPlanId: taskPlan.taskPlanId, stageId: stage.stageId, mode: stage.mode }, "omnicore: stage execution starting");

      const stepResults =
        stage.mode === "parallel"
          ? await Promise.all(stepsInStage.map((step) => this.runStep(taskPlan, step, stepResultsById, options)))
          : await this.runSequentially(taskPlan, stepsInStage, stepResultsById, options);

      for (const result of stepResults) {
        stepResultsById.set(result.stepId, result);
      }

      const stageCompletedAt = new Date();
      const stageResult: StageExecutionResult = {
        stageId: stage.stageId,
        status: "completed",
        stepResults,
        startedAt: stageStartedAt.toISOString(),
        completedAt: stageCompletedAt.toISOString(),
        durationMs: stageCompletedAt.getTime() - stageStartedAt.getTime(),
      };
      stageResults.push(stageResult);

      this.logger.debug({ taskPlanId: taskPlan.taskPlanId, stageId: stage.stageId, durationMs: stageResult.durationMs }, "omnicore: stage execution completed");
    }

    const planCompletedAt = new Date();
    const planResult: PlanExecutionResult = {
      taskPlanId: taskPlan.taskPlanId,
      status: "completed",
      stageResults,
      startedAt: planStartedAt.toISOString(),
      completedAt: planCompletedAt.toISOString(),
      durationMs: planCompletedAt.getTime() - planStartedAt.getTime(),
    };

    this.logger.debug({ taskPlanId: taskPlan.taskPlanId, durationMs: planResult.durationMs }, "omnicore: plan execution completed");

    return planResult;
  }

  /** Runs `steps` one at a time, in order, stopping (by letting the error propagate) at the first failure — the `"sequential"` stage-mode counterpart to `Promise.all` for `"parallel"`. */
  private async runSequentially(
    taskPlan: TaskPlan,
    steps: readonly TaskPlanStep[],
    stepResultsById: Map<string, StepExecutionResult>,
    options: PlanExecutionOptions,
  ): Promise<StepExecutionResult[]> {
    const results: StepExecutionResult[] = [];
    for (const step of steps) {
      const result = await this.runStep(taskPlan, step, stepResultsById, options);
      stepResultsById.set(result.stepId, result);
      results.push(result);
    }
    return results;
  }

  /**
   * Runs a single step, after confirming every one of its `dependsOn`
   * entries already completed successfully (`DEPENDENCY_FAILURE`
   * otherwise — see this class's doc comment for why that's
   * defensive, not a normal path). On success, logs and returns a
   * `"completed"` result. On failure, logs a `"failed"` result for
   * observability and then re-throws the original error unchanged —
   * this is the `"abort"` failure policy in its entirety.
   */
  private async runStep(
    taskPlan: TaskPlan,
    step: TaskPlanStep,
    stepResultsById: ReadonlyMap<string, StepExecutionResult>,
    options: PlanExecutionOptions,
  ): Promise<StepExecutionResult> {
    const unmetDependencies = step.dependsOn.filter((dependencyId) => stepResultsById.get(dependencyId)?.status !== "completed");
    if (unmetDependencies.length > 0) {
      throw omniCoreDomainError(
        "DEPENDENCY_FAILURE",
        `Step "${step.stepId}" cannot run because one or more of its dependencies did not complete successfully.`,
        { stepId: step.stepId, unmetDependencies },
      );
    }

    const startedAt = new Date();
    this.logger.debug({ taskPlanId: taskPlan.taskPlanId, stepId: step.stepId, capabilities: step.capabilities }, "omnicore: step execution starting");

    try {
      const { output, providerId, modelId, toolId } = await this.stepExecutor.execute(step, options);
      const completedAt = new Date();
      const result: StepExecutionResult = {
        stepId: step.stepId,
        status: "completed",
        output,
        providerId,
        modelId,
        toolId,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };
      this.logger.debug(
        { taskPlanId: taskPlan.taskPlanId, stepId: step.stepId, providerId, modelId, toolId, durationMs: result.durationMs },
        "omnicore: step execution completed",
      );
      return result;
    } catch (error) {
      const completedAt = new Date();
      const errorCode = this.errorCodeOf(error);
      this.logger.warn(
        {
          taskPlanId: taskPlan.taskPlanId,
          stepId: step.stepId,
          errorCode,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        "omnicore: step execution failed",
      );
      // "abort" failure policy: stop the plan by letting the original,
      // already-typed error propagate unchanged — never wrapped in
      // `STEP_EXECUTION_FAILED` or any other code of this service's own.
      throw error;
    }
  }

  /** Best-effort extraction of a thrown error's domain `code`, for the structured failure log only — never thrown or returned itself. */
  private errorCodeOf(error: unknown): string | undefined {
    if (error && typeof error === "object" && "getResponse" in error && typeof (error as { getResponse: unknown }).getResponse === "function") {
      const response = (error as { getResponse: () => unknown }).getResponse();
      if (response && typeof response === "object" && "code" in response && typeof (response as { code: unknown }).code === "string") {
        return (response as { code: string }).code;
      }
    }
    return undefined;
  }
}
