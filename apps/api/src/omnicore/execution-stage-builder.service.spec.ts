import type { TaskPlanStep } from "@omniscience/types";
import { DependencyGraphService } from "./dependency-graph.service";
import { ExecutionStageBuilderService } from "./execution-stage-builder.service";

describe("ExecutionStageBuilderService", () => {
  let service: ExecutionStageBuilderService;

  beforeEach(() => {
    service = new ExecutionStageBuilderService(new DependencyGraphService());
  });

  function stepFixture(overrides: Partial<TaskPlanStep> & Pick<TaskPlanStep, "stepId">): TaskPlanStep {
    return {
      title: "Step",
      description: "Step description",
      objective: "Step objective",
      capabilities: ["text-generation"],
      inputRequirements: "input",
      expectedOutput: "output",
      dependsOn: [],
      executionMode: "sequential",
      complexity: "low",
      failurePolicy: { mode: "abort" },
      ...overrides,
    };
  }

  it("builds a single sequential stage for a single-step plan", () => {
    const { stages, steps } = service.build([stepFixture({ stepId: "step-1" })]);

    expect(stages).toHaveLength(1);
    expect(stages[0]).toEqual(expect.objectContaining({ mode: "sequential", stepIds: ["step-1"] }));
    expect(steps[0]?.executionMode).toBe("sequential");
  });

  it("builds successive sequential stages for a linear dependency chain", () => {
    const { stages, steps } = service.build([
      stepFixture({ stepId: "step-1" }),
      stepFixture({ stepId: "step-2", dependsOn: ["step-1"] }),
    ]);

    expect(stages.map((stage) => stage.mode)).toEqual(["sequential", "sequential"]);
    expect(stages.map((stage) => stage.stepIds)).toEqual([["step-1"], ["step-2"]]);
    expect(steps.every((step) => step.executionMode === "sequential")).toBe(true);
  });

  it("marks a stage with more than one independent step as parallel", () => {
    const { stages, steps } = service.build([
      stepFixture({ stepId: "step-1" }),
      stepFixture({ stepId: "step-2" }),
    ]);

    expect(stages).toHaveLength(1);
    expect(stages[0]?.mode).toBe("parallel");
    expect(steps.every((step) => step.executionMode === "parallel")).toBe(true);
  });

  it("builds a mixed plan: a parallel stage feeding into a final sequential stage", () => {
    const { stages, steps } = service.build([
      stepFixture({ stepId: "step-1" }),
      stepFixture({ stepId: "step-2" }),
      stepFixture({ stepId: "step-3", dependsOn: ["step-1", "step-2"] }),
    ]);

    expect(stages).toHaveLength(2);
    expect(stages[0]).toEqual(expect.objectContaining({ mode: "parallel" }));
    expect(stages[0]?.stepIds).toEqual(expect.arrayContaining(["step-1", "step-2"]));
    expect(stages[1]).toEqual(expect.objectContaining({ mode: "sequential", stepIds: ["step-3"] }));

    const byId = new Map(steps.map((step) => [step.stepId, step]));
    expect(byId.get("step-1")?.executionMode).toBe("parallel");
    expect(byId.get("step-2")?.executionMode).toBe("parallel");
    expect(byId.get("step-3")?.executionMode).toBe("sequential");
  });

  it("assigns each stage a non-empty, unique stageId", () => {
    const { stages } = service.build([
      stepFixture({ stepId: "step-1" }),
      stepFixture({ stepId: "step-2", dependsOn: ["step-1"] }),
    ]);

    expect(stages[0]?.stageId.length).toBeGreaterThan(0);
    expect(stages[1]?.stageId.length).toBeGreaterThan(0);
    expect(stages[0]?.stageId).not.toBe(stages[1]?.stageId);
  });

  it("propagates a circular dependency rejection from the dependency graph", () => {
    const steps = [
      stepFixture({ stepId: "step-1", dependsOn: ["step-2"] }),
      stepFixture({ stepId: "step-2", dependsOn: ["step-1"] }),
    ];

    expect(() => service.build(steps)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "CIRCULAR_DEPENDENCY" }) }),
    );
  });
});
