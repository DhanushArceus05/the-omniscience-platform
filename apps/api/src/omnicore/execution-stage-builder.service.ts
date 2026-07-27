import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { ExecutionStage, StepExecutionMode, TaskPlanStep } from "@omniscience/types";
import { DependencyGraphService } from "./dependency-graph.service";

/**
 * Turns a validated dependency layering into `TaskPlan.stages` (Phase
 * 5 Step 3, requirement 4 "Sequential and parallel execution
 * planning"). Depends on `DependencyGraphService` rather than
 * re-deriving layers itself — this service's only job is turning an
 * already-validated `DependencyGraphResult` into the public
 * `ExecutionStage` shape and annotating each step's
 * `executionMode` to match.
 *
 * A layer with more than one step is a `"parallel"` stage: by
 * construction (`DependencyGraphService.layers()`), no step in a
 * layer depends on another step in that same layer, so every step in
 * a multi-step layer is genuinely safe to attempt concurrently. A
 * layer with exactly one step is always `"sequential"` — there is
 * nothing to parallelize against. This method does not implement
 * actually running anything concurrently; that is explicitly Phase 5
 * Step 4 orchestration work.
 */
@Injectable()
export class ExecutionStageBuilderService {
  constructor(private readonly dependencyGraph: DependencyGraphService) {}

  /**
   * Builds `TaskPlan.stages` from `steps`, and returns each step with
   * its `executionMode` set to match the stage it landed in — the
   * step-level `executionMode` and the stage it belongs to can never
   * disagree, since both are derived from the same layering in one
   * pass.
   */
  build(steps: readonly TaskPlanStep[]): { stages: readonly ExecutionStage[]; steps: readonly TaskPlanStep[] } {
    const { layers } = this.dependencyGraph.layers(steps);
    const stepsById = new Map(steps.map((step) => [step.stepId, step]));

    const stages: ExecutionStage[] = [];
    const orderedSteps: TaskPlanStep[] = [];

    for (const layer of layers) {
      const mode: StepExecutionMode = layer.length > 1 ? "parallel" : "sequential";
      stages.push({ stageId: randomUUID(), mode, stepIds: layer });

      for (const stepId of layer) {
        const step = stepsById.get(stepId);
        /* istanbul ignore next -- defensive: every id in a layer comes from `steps` itself */
        if (!step) {
          continue;
        }
        orderedSteps.push(step.executionMode === mode ? step : { ...step, executionMode: mode });
      }
    }

    return { stages, steps: orderedSteps };
  }
}
