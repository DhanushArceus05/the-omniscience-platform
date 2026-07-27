import type { TaskPlanStep } from "@omniscience/types";
import { PlanValidatorService } from "./plan-validator.service";

describe("PlanValidatorService", () => {
  let service: PlanValidatorService;

  beforeEach(() => {
    service = new PlanValidatorService();
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

  it("accepts a well-formed single-step plan without throwing", () => {
    expect(() => service.validateSteps([stepFixture({ stepId: "step-1" })])).not.toThrow();
  });

  it("accepts a well-formed multi-step plan without throwing", () => {
    expect(() =>
      service.validateSteps([
        stepFixture({ stepId: "step-1" }),
        stepFixture({ stepId: "step-2", dependsOn: ["step-1"] }),
      ]),
    ).not.toThrow();
  });

  it("rejects an empty plan", () => {
    expect(() => service.validateSteps([])).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "INVALID_TASK_PLAN" }) }),
    );
  });

  it("rejects a step with no required capabilities", () => {
    const steps = [stepFixture({ stepId: "step-1", capabilities: [] })];

    expect(() => service.validateSteps(steps)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "INVALID_TASK_PLAN" }) }),
    );
  });

  it("rejects a step requiring a capability no resolved intent maps to", () => {
    const steps = [stepFixture({ stepId: "step-1", capabilities: ["vision"] })];

    expect(() => service.validateSteps(steps)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY_MAPPING" }),
      }),
    );
  });

  it("includes the offending step id and capability in the UNSUPPORTED_CAPABILITY_MAPPING details", () => {
    const steps = [stepFixture({ stepId: "step-1", capabilities: ["speech-to-text"] })];

    expect(() => service.validateSteps(steps)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          unsupported: [{ stepId: "step-1", capability: "speech-to-text" }],
        }),
      }),
    );
  });
});
