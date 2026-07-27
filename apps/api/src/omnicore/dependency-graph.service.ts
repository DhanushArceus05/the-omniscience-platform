import { Injectable } from "@nestjs/common";
import type { TaskPlanStep } from "@omniscience/types";
import { omniCoreDomainError } from "./omnicore.errors";

/**
 * A `TaskPlanStep`'s dependency graph, topologically ordered into
 * layers: `layers[0]` holds every step with no unresolved dependency,
 * `layers[1]` every step whose dependencies are all satisfied by
 * `layers[0]`, and so on. Two steps can only ever land in the same
 * layer if neither depends (even transitively) on the other — a
 * dependency between them would necessarily place the dependent one
 * layer later. `ExecutionStageBuilderService` turns this directly into
 * `TaskPlan.stages` without any further graph work of its own.
 */
export interface DependencyGraphResult {
  readonly layers: readonly (readonly string[])[];
}

/**
 * Validates `TaskPlanStep.dependsOn` references and computes a
 * topologically valid execution order (Phase 5 Step 3, requirement 3
 * "Dependency graph"). Deliberately the single place this validation
 * happens — `PlanValidatorService` delegates to it rather than
 * re-implementing cycle/reference checking, and `TaskPlannerService`
 * never builds a `TaskPlan.stages` value without routing through
 * `layers()` first.
 *
 * Every check below is a defensive guard against a plan that could
 * only exist if a future step or a bug produced malformed
 * `dependsOn` values — `TaskPlannerService` itself, as of Step 3,
 * only ever builds single-step plans with an empty `dependsOn`, so
 * every one of these throws is exercised by hand-built multi-step
 * fixtures in this service's own unit tests, not by any real request
 * through `POST /omnicore/execute` today.
 */
@Injectable()
export class DependencyGraphService {
  /**
   * Validates every `dependsOn` reference in `steps` and returns the
   * topological layering used to build `TaskPlan.stages`.
   *
   * Throws `DUPLICATE_STEP_ID` if two steps share a `stepId` (checked
   * first, since every other check assumes `stepId`s are unique keys
   * into the plan), `MISSING_DEPENDENCY` if any `dependsOn` entry
   * doesn't reference a real step in `steps` (including a step naming
   * itself, which is never valid — a step cannot depend on its own
   * completion), and `CIRCULAR_DEPENDENCY` if the remaining graph
   * cannot be fully layered — i.e. some steps' dependencies are only
   * satisfiable by each other, never by an earlier layer.
   */
  layers(steps: readonly TaskPlanStep[]): DependencyGraphResult {
    this.assertNoDuplicateIds(steps);
    this.assertDependenciesExist(steps);

    const stepIds = steps.map((step) => step.stepId);
    const remaining = new Set(stepIds);
    const resolved = new Set<string>();
    const layers: string[][] = [];

    while (remaining.size > 0) {
      const layer = steps
        .filter((step) => remaining.has(step.stepId))
        .filter((step) => step.dependsOn.every((dependencyId) => resolved.has(dependencyId)))
        .map((step) => step.stepId);

      if (layer.length === 0) {
        // Every remaining step has at least one still-unresolved
        // dependency, and every dependency reference was already
        // confirmed to exist among `steps` — the only way that's
        // possible is a cycle among the steps still remaining.
        throw omniCoreDomainError(
          "CIRCULAR_DEPENDENCY",
          "The task plan's steps contain a circular dependency and cannot be topologically ordered.",
          { stepIds: [...remaining] },
        );
      }

      for (const stepId of layer) {
        remaining.delete(stepId);
        resolved.add(stepId);
      }
      layers.push(layer);
    }

    return { layers };
  }

  private assertNoDuplicateIds(steps: readonly TaskPlanStep[]): void {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.stepId)) {
        duplicates.add(step.stepId);
      }
      seen.add(step.stepId);
    }
    if (duplicates.size > 0) {
      throw omniCoreDomainError("DUPLICATE_STEP_ID", "The task plan contains duplicate step ids.", {
        stepIds: [...duplicates],
      });
    }
  }

  private assertDependenciesExist(steps: readonly TaskPlanStep[]): void {
    const stepIds = new Set(steps.map((step) => step.stepId));
    const missing = new Set<string>();

    for (const step of steps) {
      for (const dependencyId of step.dependsOn) {
        if (dependencyId === step.stepId || !stepIds.has(dependencyId)) {
          missing.add(dependencyId);
        }
      }
    }

    if (missing.size > 0) {
      throw omniCoreDomainError(
        "MISSING_DEPENDENCY",
        "The task plan references a dependency step id that does not exist in the plan.",
        { stepIds: [...missing] },
      );
    }
  }
}
