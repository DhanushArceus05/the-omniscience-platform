import { describe, expect, it } from "vitest";
import type { ExecutionStage, TaskComplexity, TaskPlan, TaskPlanStep } from "./omnicore-plan";

describe("omnicore-plan type shapes", () => {
  function stepFixture(overrides: Partial<TaskPlanStep> = {}): TaskPlanStep {
    return {
      stepId: "step-1",
      title: "Draft the response",
      description: "Generate the primary response text.",
      objective: "Answer the user's request.",
      capabilities: ["text-generation"],
      inputRequirements: "The user's prompt",
      expectedOutput: "Generated text satisfying the request",
      dependsOn: [],
      executionMode: "sequential",
      complexity: "low",
      failurePolicy: { mode: "abort" },
      ...overrides,
    };
  }

  it("builds a valid single-step, single-stage TaskPlan", () => {
    const step = stepFixture();
    const stage: ExecutionStage = { stageId: "stage-1", mode: "sequential", stepIds: [step.stepId] };
    const plan: TaskPlan = {
      taskPlanId: "task-plan-1",
      sourceCapabilityPlanId: "capability-plan-1",
      intent: "simple-generation",
      steps: [step],
      stages: [stage],
      complexity: "low",
    };

    expect(plan.steps).toHaveLength(1);
    expect(plan.stages).toHaveLength(1);
    expect(plan.stages[0]?.mode).toBe("sequential");
  });

  it("builds a valid multi-step plan with a dependency and an optional toolCategory", () => {
    const first = stepFixture({ stepId: "step-1" });
    const second = stepFixture({
      stepId: "step-2",
      dependsOn: ["step-1"],
      toolCategory: "web-search",
      failurePolicy: { mode: "retry", maxAttempts: 3 },
    });

    const plan: TaskPlan = {
      taskPlanId: "task-plan-2",
      sourceCapabilityPlanId: "capability-plan-2",
      intent: "code-generation",
      steps: [first, second],
      stages: [
        { stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] },
        { stageId: "stage-2", mode: "sequential", stepIds: ["step-2"] },
      ],
      complexity: "medium",
    };

    expect(plan.steps[1]?.dependsOn).toEqual(["step-1"]);
    expect(plan.steps[1]?.toolCategory).toBe("web-search");
    expect(plan.steps[1]?.failurePolicy).toEqual({ mode: "retry", maxAttempts: 3 });
  });

  it("allows a parallel stage referencing more than one independent step", () => {
    const stage: ExecutionStage = {
      stageId: "stage-parallel",
      mode: "parallel",
      stepIds: ["step-a", "step-b"],
    };
    expect(stage.stepIds).toHaveLength(2);
  });

  it("covers every TaskComplexity value", () => {
    const complexities: readonly TaskComplexity[] = ["low", "medium", "high", "very-high"];
    for (const complexity of complexities) {
      const plan: TaskPlan = {
        taskPlanId: "task-plan-3",
        sourceCapabilityPlanId: "capability-plan-3",
        intent: "code-generation",
        steps: [stepFixture({ complexity })],
        stages: [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] }],
        complexity,
      };
      expect(plan.complexity).toBe(complexity);
    }
  });
});
