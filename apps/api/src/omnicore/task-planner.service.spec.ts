import type { CapabilityPlan, ResolvedOmniCoreIntent } from "@omniscience/types";
import { ComplexityEstimatorService } from "./complexity-estimator.service";
import { DependencyGraphService } from "./dependency-graph.service";
import { ExecutionStageBuilderService } from "./execution-stage-builder.service";
import { PlanValidatorService } from "./plan-validator.service";
import { TaskPlannerService } from "./task-planner.service";

describe("TaskPlannerService", () => {
  let service: TaskPlannerService;

  beforeEach(() => {
    const dependencyGraph = new DependencyGraphService();
    service = new TaskPlannerService(
      new ExecutionStageBuilderService(dependencyGraph),
      new ComplexityEstimatorService(),
      new PlanValidatorService(),
    );
  });

  function capabilityPlanFor(intent: ResolvedOmniCoreIntent, input = "Do the thing"): CapabilityPlan {
    return {
      planId: "capability-plan-1",
      intent,
      steps: [{ stepId: "step-1", capability: "text-generation", input }],
    };
  }

  describe.each<ResolvedOmniCoreIntent>([
    "simple-generation",
    "question-answering",
    "code-generation",
    "summarization",
    "creative-writing",
  ])("for the %s intent", (intent) => {
    it("builds a single-step, single-stage plan carrying the intent through unchanged", () => {
      const taskPlan = service.plan(capabilityPlanFor(intent));

      expect(taskPlan.intent).toBe(intent);
      expect(taskPlan.steps).toHaveLength(1);
      expect(taskPlan.stages).toHaveLength(1);
      expect(taskPlan.stages[0]).toEqual(
        expect.objectContaining({ mode: "sequential", stepIds: [taskPlan.steps[0]?.stepId] }),
      );
    });

    it("gives the single step a title, objective, and expected output that aren't empty strings", () => {
      const taskPlan = service.plan(capabilityPlanFor(intent));
      const [step] = taskPlan.steps;

      expect(step?.title.length).toBeGreaterThan(0);
      expect(step?.objective.length).toBeGreaterThan(0);
      expect(step?.expectedOutput.length).toBeGreaterThan(0);
    });
  });

  it("preserves the source capability plan's id, step id, capability, and input verbatim", () => {
    const capabilityPlan = capabilityPlanFor("summarization", "Summarize this article");
    const taskPlan = service.plan(capabilityPlan);

    expect(taskPlan.sourceCapabilityPlanId).toBe(capabilityPlan.planId);
    expect(taskPlan.steps[0]?.stepId).toBe(capabilityPlan.steps[0]?.stepId);
    expect(taskPlan.steps[0]?.capabilities).toEqual(["text-generation"]);
    expect(taskPlan.steps[0]?.inputRequirements).toBe("Summarize this article");
  });

  it("gives the single step an empty dependsOn and abort failure policy", () => {
    const taskPlan = service.plan(capabilityPlanFor("simple-generation"));

    expect(taskPlan.steps[0]?.dependsOn).toEqual([]);
    expect(taskPlan.steps[0]?.failurePolicy).toEqual({ mode: "abort" });
  });

  it("rates a single-step plan's overall complexity as low", () => {
    const taskPlan = service.plan(capabilityPlanFor("simple-generation"));
    expect(taskPlan.complexity).toBe("low");
  });

  it("assigns a non-empty, unique taskPlanId on every call", () => {
    const first = service.plan(capabilityPlanFor("simple-generation"));
    const second = service.plan(capabilityPlanFor("simple-generation"));

    expect(first.taskPlanId.length).toBeGreaterThan(0);
    expect(first.taskPlanId).not.toBe(second.taskPlanId);
  });

  it("throws INVALID_TASK_PLAN rather than building a plan for a capability plan with zero steps", () => {
    const capabilityPlan: CapabilityPlan = { planId: "capability-plan-1", intent: "simple-generation", steps: [] };

    expect(() => service.plan(capabilityPlan)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "INVALID_TASK_PLAN" }) }),
    );
  });
});
