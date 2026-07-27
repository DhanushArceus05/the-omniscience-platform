import type { TaskPlanStep } from "@omniscience/types";
import { DependencyGraphService } from "./dependency-graph.service";

describe("DependencyGraphService", () => {
  let service: DependencyGraphService;

  beforeEach(() => {
    service = new DependencyGraphService();
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

  it("places a single step with no dependencies into a single layer", () => {
    const steps = [stepFixture({ stepId: "step-1" })];

    const result = service.layers(steps);

    expect(result.layers).toEqual([["step-1"]]);
  });

  it("orders a linear chain of dependencies into successive single-step layers", () => {
    const steps = [
      stepFixture({ stepId: "step-1" }),
      stepFixture({ stepId: "step-2", dependsOn: ["step-1"] }),
      stepFixture({ stepId: "step-3", dependsOn: ["step-2"] }),
    ];

    const result = service.layers(steps);

    expect(result.layers).toEqual([["step-1"], ["step-2"], ["step-3"]]);
  });

  it("groups independent steps with no dependency between them into the same layer", () => {
    const steps = [
      stepFixture({ stepId: "step-1" }),
      stepFixture({ stepId: "step-2" }),
      stepFixture({ stepId: "step-3" }),
    ];

    const result = service.layers(steps);

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toEqual(expect.arrayContaining(["step-1", "step-2", "step-3"]));
  });

  it("mixes sequential and parallel layers: two independent steps feeding one final step", () => {
    const steps = [
      stepFixture({ stepId: "step-1" }),
      stepFixture({ stepId: "step-2" }),
      stepFixture({ stepId: "step-3", dependsOn: ["step-1", "step-2"] }),
    ];

    const result = service.layers(steps);

    expect(result.layers).toHaveLength(2);
    expect(result.layers[0]).toEqual(expect.arrayContaining(["step-1", "step-2"]));
    expect(result.layers[1]).toEqual(["step-3"]);
  });

  it("rejects a direct circular dependency between two steps", () => {
    const steps = [
      stepFixture({ stepId: "step-1", dependsOn: ["step-2"] }),
      stepFixture({ stepId: "step-2", dependsOn: ["step-1"] }),
    ];

    expect(() => service.layers(steps)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "CIRCULAR_DEPENDENCY" }) }),
    );
  });

  it("rejects a longer circular dependency chain", () => {
    const steps = [
      stepFixture({ stepId: "step-1", dependsOn: ["step-3"] }),
      stepFixture({ stepId: "step-2", dependsOn: ["step-1"] }),
      stepFixture({ stepId: "step-3", dependsOn: ["step-2"] }),
    ];

    expect(() => service.layers(steps)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "CIRCULAR_DEPENDENCY" }) }),
    );
  });

  it("rejects a step referencing a dependency step id that doesn't exist in the plan", () => {
    const steps = [stepFixture({ stepId: "step-1", dependsOn: ["step-missing"] })];

    expect(() => service.layers(steps)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "MISSING_DEPENDENCY" }) }),
    );
  });

  it("rejects a step that names itself as its own dependency", () => {
    const steps = [stepFixture({ stepId: "step-1", dependsOn: ["step-1"] })];

    expect(() => service.layers(steps)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "MISSING_DEPENDENCY" }) }),
    );
  });

  it("rejects duplicate step ids before evaluating dependencies", () => {
    const steps = [stepFixture({ stepId: "step-1" }), stepFixture({ stepId: "step-1" })];

    expect(() => service.layers(steps)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "DUPLICATE_STEP_ID" }) }),
    );
  });
});
