import { Injectable } from "@nestjs/common";
import type { ExecutionStage, TaskComplexity, TaskPlanStep } from "@omniscience/types";

/**
 * A step's complexity signal count crosses a threshold at these
 * boundaries. `estimateStep()`/`estimateTask()` both reduce their
 * inputs to a single non-negative "score" and look it up here — see
 * each method's doc comment for what feeds the score.
 */
const COMPLEXITY_THRESHOLDS: Readonly<Record<Exclude<TaskComplexity, "low">, number>> = {
  medium: 2,
  high: 4,
  "very-high": 7,
};

function classifyByScore(score: number): TaskComplexity {
  if (score >= COMPLEXITY_THRESHOLDS["very-high"]) {
    return "very-high";
  }
  if (score >= COMPLEXITY_THRESHOLDS.high) {
    return "high";
  }
  if (score >= COMPLEXITY_THRESHOLDS.medium) {
    return "medium";
  }
  return "low";
}

const COMPLEXITY_RANK: Readonly<Record<TaskComplexity, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  "very-high": 3,
};

/**
 * Classifies `TaskPlanStep`/overall `TaskPlan` complexity (Phase 5
 * Step 3, requirement 5 "Complexity estimation") from plan shape
 * alone — no model call, no timing measurement, same "deterministic
 * heuristic, not inference" spirit as `FastRulesEngineService`.
 * Reused directly by `TaskPlannerService` for each step's own
 * `complexity` field and for the plan's overall `TaskPlan.complexity`.
 */
@Injectable()
export class ComplexityEstimatorService {
  /**
   * A single step's score sums: one point per required capability
   * beyond the first (a step needing several capabilities at once is
   * doing more), two points for having a `toolCategory` at all (an
   * external tool dependency is a real added failure surface a plain
   * model call doesn't have), and one point per dependency the step
   * has (each dependency is one more precondition that can fail or
   * delay this step). A step with one capability, no tool, and no
   * dependencies — every step `TaskPlannerService` produces today —
   * scores `0` and is always `"low"`.
   */
  estimateStep(step: Pick<TaskPlanStep, "capabilities" | "toolCategory" | "dependsOn">): TaskComplexity {
    const capabilityScore = Math.max(0, step.capabilities.length - 1);
    const toolScore = step.toolCategory ? 2 : 0;
    const dependencyScore = step.dependsOn.length;
    return classifyByScore(capabilityScore + toolScore + dependencyScore);
  }

  /**
   * An overall plan's score sums: one point per step beyond the first
   * (more steps is more to get right), one point per additional
   * execution stage beyond the first (more stages means more
   * hand-offs and more places ordering can go wrong), two points if
   * any stage is `"parallel"` (concurrent execution is a strictly
   * harder failure mode than a purely sequential plan), the count of
   * distinct required capabilities across every step beyond the
   * first, and finally the plan is never rated below the single
   * highest per-step `complexity` among its own steps — an overall
   * plan can't be rated simpler than its hardest single step.
   */
  estimateTask(steps: readonly TaskPlanStep[], stages: readonly ExecutionStage[]): TaskComplexity {
    const stepScore = Math.max(0, steps.length - 1);
    const stageScore = Math.max(0, stages.length - 1);
    const parallelScore = stages.some((stage) => stage.mode === "parallel") ? 2 : 0;
    const distinctCapabilities = new Set(steps.flatMap((step) => step.capabilities));
    const capabilityScore = Math.max(0, distinctCapabilities.size - 1);

    const byScore = classifyByScore(stepScore + stageScore + parallelScore + capabilityScore);
    const highestStepComplexity = steps.reduce<TaskComplexity>(
      (highest, step) => (COMPLEXITY_RANK[step.complexity] > COMPLEXITY_RANK[highest] ? step.complexity : highest),
      "low",
    );

    return COMPLEXITY_RANK[highestStepComplexity] > COMPLEXITY_RANK[byScore] ? highestStepComplexity : byScore;
  }
}
