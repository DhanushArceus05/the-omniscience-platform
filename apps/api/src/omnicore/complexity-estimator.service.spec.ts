import type { ExecutionStage, TaskPlanStep } from "@omniscience/types";
import { ComplexityEstimatorService } from "./complexity-estimator.service";

describe("ComplexityEstimatorService", () => {
  let service: ComplexityEstimatorService;

  beforeEach(() => {
    service = new ComplexityEstimatorService();
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

  describe("estimateStep()", () => {
    it("rates a plain single-capability, tool-free, dependency-free step as low", () => {
      expect(service.estimateStep({ capabilities: ["text-generation"], dependsOn: [] })).toBe("low");
    });

    it("rates a step with a tool category as at least medium", () => {
      const complexity = service.estimateStep({
        capabilities: ["text-generation"],
        toolCategory: "web-search",
        dependsOn: [],
      });
      expect(["medium", "high", "very-high"]).toContain(complexity);
    });

    it("rates a step with several dependencies as higher complexity than one with none", () => {
      const withoutDeps = service.estimateStep({ capabilities: ["text-generation"], dependsOn: [] });
      const withDeps = service.estimateStep({
        capabilities: ["text-generation"],
        dependsOn: ["a", "b", "c", "d"],
      });
      const rank = { low: 0, medium: 1, high: 2, "very-high": 3 } as const;
      expect(rank[withDeps]).toBeGreaterThan(rank[withoutDeps]);
    });

    it("rates a step requiring multiple capabilities as higher complexity than a single-capability step", () => {
      const single = service.estimateStep({ capabilities: ["text-generation"], dependsOn: [] });
      const multi = service.estimateStep({
        capabilities: ["text-generation", "structured-output", "tool-calling"],
        dependsOn: [],
      });
      const rank = { low: 0, medium: 1, high: 2, "very-high": 3 } as const;
      expect(rank[multi]).toBeGreaterThan(rank[single]);
    });

    it("reaches very-high for a step combining many capabilities, a tool, and many dependencies", () => {
      const complexity = service.estimateStep({
        capabilities: ["text-generation", "structured-output", "tool-calling", "vision"],
        toolCategory: "code-execution",
        dependsOn: ["a", "b", "c"],
      });
      expect(complexity).toBe("very-high");
    });
  });

  describe("estimateTask()", () => {
    it("rates a single-step, single-stage plan as low", () => {
      const steps = [stepFixture({ stepId: "step-1" })];
      const stages: ExecutionStage[] = [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] }];

      expect(service.estimateTask(steps, stages)).toBe("low");
    });

    it("rates a plan with a parallel stage as more complex than an equivalent sequential-only plan", () => {
      const steps = [
        stepFixture({ stepId: "step-1" }),
        stepFixture({ stepId: "step-2", dependsOn: ["step-1"] }),
      ];
      const sequentialStages: ExecutionStage[] = [
        { stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] },
        { stageId: "stage-2", mode: "sequential", stepIds: ["step-2"] },
      ];

      const parallelSteps = [stepFixture({ stepId: "step-1" }), stepFixture({ stepId: "step-2" })];
      const parallelStages: ExecutionStage[] = [
        { stageId: "stage-1", mode: "parallel", stepIds: ["step-1", "step-2"] },
      ];

      const rank = { low: 0, medium: 1, high: 2, "very-high": 3 } as const;
      const sequentialComplexity = service.estimateTask(steps, sequentialStages);
      const parallelComplexity = service.estimateTask(parallelSteps, parallelStages);

      expect(rank[parallelComplexity]).toBeGreaterThanOrEqual(rank[sequentialComplexity]);
    });

    it("never rates the overall plan below its single most complex step", () => {
      const steps = [stepFixture({ stepId: "step-1", complexity: "very-high" })];
      const stages: ExecutionStage[] = [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] }];

      expect(service.estimateTask(steps, stages)).toBe("very-high");
    });

    it("rates a many-step, many-stage plan with diverse capabilities as high or very-high", () => {
      const steps = [
        stepFixture({ stepId: "step-1", capabilities: ["text-generation"] }),
        stepFixture({ stepId: "step-2", capabilities: ["structured-output"], dependsOn: ["step-1"] }),
        stepFixture({ stepId: "step-3", capabilities: ["tool-calling"], dependsOn: ["step-2"] }),
        stepFixture({ stepId: "step-4", capabilities: ["vision"], dependsOn: ["step-3"] }),
      ];
      const stages: ExecutionStage[] = [
        { stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] },
        { stageId: "stage-2", mode: "sequential", stepIds: ["step-2"] },
        { stageId: "stage-3", mode: "sequential", stepIds: ["step-3"] },
        { stageId: "stage-4", mode: "sequential", stepIds: ["step-4"] },
      ];

      expect(["high", "very-high"]).toContain(service.estimateTask(steps, stages));
    });
  });
});
