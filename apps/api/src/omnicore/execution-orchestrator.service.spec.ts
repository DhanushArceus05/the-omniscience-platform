import type { Logger } from "pino";
import type { TaskPlan, TaskPlanStep } from "@omniscience/types";
import { DependencyGraphService } from "./dependency-graph.service";
import { ExecutionOrchestratorService } from "./execution-orchestrator.service";
import { StepExecutorService } from "./step-executor.service";

describe("ExecutionOrchestratorService", () => {
  const stepExecutor = { execute: jest.fn() };
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  let service: ExecutionOrchestratorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExecutionOrchestratorService(
      stepExecutor as unknown as StepExecutorService,
      new DependencyGraphService(),
      logger as unknown as Logger,
    );
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

  function planFixture(steps: readonly TaskPlanStep[], stages: TaskPlan["stages"]): TaskPlan {
    return {
      taskPlanId: "task-plan-1",
      sourceCapabilityPlanId: "capability-plan-1",
      intent: "simple-generation",
      steps,
      stages,
      complexity: "low",
    };
  }

  function outputFor(stepId: string): { output: string; providerId: "anthropic"; modelId: "claude-sonnet-5" } {
    return { output: `output-of-${stepId}`, providerId: "anthropic", modelId: "claude-sonnet-5" };
  }

  it("executes a single-step, single-stage plan and returns a completed PlanExecutionResult", async () => {
    const plan = planFixture(
      [stepFixture({ stepId: "step-1" })],
      [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] }],
    );
    stepExecutor.execute.mockResolvedValue(outputFor("step-1"));

    const result = await service.execute(plan);

    expect(result.status).toBe("completed");
    expect(result.taskPlanId).toBe("task-plan-1");
    expect(result.stageResults).toHaveLength(1);
    expect(result.stageResults[0]?.status).toBe("completed");
    expect(result.stageResults[0]?.stepResults[0]).toEqual(
      expect.objectContaining({ stepId: "step-1", status: "completed", output: "output-of-step-1" }),
    );
    expect(typeof result.durationMs).toBe("number");
  });

  it("executes a sequential stage's steps one at a time, in stepIds order", async () => {
    const callOrder: string[] = [];
    stepExecutor.execute.mockImplementation(async (step: TaskPlanStep) => {
      callOrder.push(step.stepId);
      return outputFor(step.stepId);
    });

    const plan = planFixture(
      [stepFixture({ stepId: "step-1" }), stepFixture({ stepId: "step-2", dependsOn: ["step-1"] })],
      [
        { stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] },
        { stageId: "stage-2", mode: "sequential", stepIds: ["step-2"] },
      ],
    );

    await service.execute(plan);

    expect(callOrder).toEqual(["step-1", "step-2"]);
  });

  it("executes a parallel stage's steps concurrently, regardless of stepIds order", async () => {
    const startedOrder: string[] = [];
    const finishedOrder: string[] = [];
    stepExecutor.execute.mockImplementation(async (step: TaskPlanStep) => {
      startedOrder.push(step.stepId);
      // step-1 resolves slower than step-2, so a truly sequential
      // implementation would still finish step-1 before step-2 starts.
      await new Promise((resolve) => setTimeout(resolve, step.stepId === "step-1" ? 20 : 0));
      finishedOrder.push(step.stepId);
      return outputFor(step.stepId);
    });

    const plan = planFixture(
      [stepFixture({ stepId: "step-1" }), stepFixture({ stepId: "step-2" })],
      [{ stageId: "stage-1", mode: "parallel", stepIds: ["step-1", "step-2"] }],
    );

    const result = await service.execute(plan);

    // Both steps had started before either finished — proof they ran concurrently.
    expect(startedOrder).toEqual(["step-1", "step-2"]);
    expect(finishedOrder).toEqual(["step-2", "step-1"]);
    expect(result.stageResults[0]?.stepResults.map((r) => r.stepId).sort()).toEqual(["step-1", "step-2"]);
  });

  it("enforces dependency ordering: a step only runs after its stage's predecessor stage completes", async () => {
    stepExecutor.execute.mockImplementation(async (step: TaskPlanStep) => outputFor(step.stepId));

    const plan = planFixture(
      [stepFixture({ stepId: "step-1" }), stepFixture({ stepId: "step-2", dependsOn: ["step-1"] })],
      [
        { stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] },
        { stageId: "stage-2", mode: "sequential", stepIds: ["step-2"] },
      ],
    );

    await service.execute(plan);

    const [firstCallArg] = stepExecutor.execute.mock.calls[0] as [TaskPlanStep];
    expect(firstCallArg.stepId).toBe("step-1");
  });

  it("throws DEPENDENCY_FAILURE if a step's dependency did not complete successfully", async () => {
    // A deliberately malformed plan: step-2 depends on step-1, but the
    // stages don't actually guarantee step-1 ran first (both in one
    // stage) — this is not a shape `TaskPlannerService` would ever
    // produce, but the orchestrator must not assume that of whatever
    // `TaskPlan` it's handed.
    const plan = planFixture(
      [stepFixture({ stepId: "step-1" }), stepFixture({ stepId: "step-2", dependsOn: ["step-1"] })],
      [{ stageId: "stage-1", mode: "parallel", stepIds: ["step-2"] }],
    );

    await expect(service.execute(plan)).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "DEPENDENCY_FAILURE" }) }),
    );
    expect(stepExecutor.execute).not.toHaveBeenCalled();
  });

  it("throws INVALID_EXECUTION_STATE if a stage references a step id absent from the plan", async () => {
    const plan = planFixture(
      [stepFixture({ stepId: "step-1" })],
      [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-missing"] }],
    );

    await expect(service.execute(plan)).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "INVALID_EXECUTION_STATE" }) }),
    );
  });

  it("propagates a circular-dependency rejection from the dependency graph before executing anything", async () => {
    const plan = planFixture(
      [
        stepFixture({ stepId: "step-1", dependsOn: ["step-2"] }),
        stepFixture({ stepId: "step-2", dependsOn: ["step-1"] }),
      ],
      [{ stageId: "stage-1", mode: "parallel", stepIds: ["step-1", "step-2"] }],
    );

    await expect(service.execute(plan)).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "CIRCULAR_DEPENDENCY" }) }),
    );
    expect(stepExecutor.execute).not.toHaveBeenCalled();
  });

  it("propagates a step failure unchanged (abort failure policy) and never runs a later stage", async () => {
    const stepError = { response: { code: "PROVIDER_RATE_LIMITED" } };
    stepExecutor.execute
      .mockRejectedValueOnce(stepError)
      .mockResolvedValue(outputFor("step-2"));

    const plan = planFixture(
      [stepFixture({ stepId: "step-1" }), stepFixture({ stepId: "step-2", dependsOn: ["step-1"] })],
      [
        { stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] },
        { stageId: "stage-2", mode: "sequential", stepIds: ["step-2"] },
      ],
    );

    await expect(service.execute(plan)).rejects.toBe(stepError);
    expect(stepExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it("propagates a failure from one step in a sequential stage and never runs the remaining steps in that stage", async () => {
    const stepError = { response: { code: "PROVIDER_RATE_LIMITED" } };
    stepExecutor.execute
      .mockResolvedValueOnce(outputFor("step-1"))
      .mockRejectedValueOnce(stepError)
      .mockResolvedValue(outputFor("step-3"));

    const plan = planFixture(
      [
        stepFixture({ stepId: "step-1" }),
        stepFixture({ stepId: "step-2" }),
        stepFixture({ stepId: "step-3" }),
      ],
      [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1", "step-2", "step-3"] }],
    );

    await expect(service.execute(plan)).rejects.toBe(stepError);
    expect(stepExecutor.execute).toHaveBeenCalledTimes(2);
  });

  it("propagates a timeout error unchanged when the step executor times out", async () => {
    const timeoutError = { response: { code: "EXECUTION_TIMEOUT" } };
    stepExecutor.execute.mockRejectedValue(timeoutError);

    const plan = planFixture(
      [stepFixture({ stepId: "step-1" })],
      [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] }],
    );

    await expect(service.execute(plan)).rejects.toBe(timeoutError);
  });

  it("propagates a cancellation error unchanged when the step executor is cancelled", async () => {
    const cancelledError = { response: { code: "EXECUTION_CANCELLED" } };
    stepExecutor.execute.mockRejectedValue(cancelledError);

    const plan = planFixture(
      [stepFixture({ stepId: "step-1" })],
      [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] }],
    );

    await expect(service.execute(plan)).rejects.toBe(cancelledError);
  });

  it("forwards execution options (timeoutMs/signal) to the step executor for every step", async () => {
    stepExecutor.execute.mockImplementation(async (step: TaskPlanStep) => outputFor(step.stepId));
    const controller = new AbortController();

    const plan = planFixture(
      [stepFixture({ stepId: "step-1" })],
      [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] }],
    );

    await service.execute(plan, { timeoutMs: 500, signal: controller.signal });

    expect(stepExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: "step-1" }),
      { timeoutMs: 500, signal: controller.signal },
    );
  });

  it("gives every step and stage result a status of completed, with timestamps, on the success path", async () => {
    stepExecutor.execute.mockImplementation(async (step: TaskPlanStep) => outputFor(step.stepId));

    const plan = planFixture(
      [stepFixture({ stepId: "step-1" })],
      [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] }],
    );

    const result = await service.execute(plan);

    expect(result.status).toBe("completed");
    expect(result.stageResults[0]?.status).toBe("completed");
    expect(result.stageResults[0]?.stepResults[0]?.status).toBe("completed");
    expect(result.stageResults[0]?.stepResults[0]?.startedAt).toEqual(expect.any(String));
    expect(result.stageResults[0]?.stepResults[0]?.completedAt).toEqual(expect.any(String));
    expect(typeof result.stageResults[0]?.stepResults[0]?.durationMs).toBe("number");
  });
});
