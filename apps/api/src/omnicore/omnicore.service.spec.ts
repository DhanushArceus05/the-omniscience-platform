import type { Logger } from "pino";
import type { CapabilityPlan, FastRuleMatch, PlanExecutionResult, TaskPlan } from "@omniscience/types";
import { CapabilityPlanBuilderService } from "./capability-plan-builder.service";
import { ExecutionOrchestratorService } from "./execution-orchestrator.service";
import { FastRulesEngineService } from "./fast-rules-engine.service";
import { OmniCoreService } from "./omnicore.service";
import { TaskPlannerService } from "./task-planner.service";

describe("OmniCoreService", () => {
  const fastRules = { classify: jest.fn() };
  const planBuilder = { build: jest.fn() };
  const taskPlanner = { plan: jest.fn() };
  const orchestrator = { execute: jest.fn(), executeStream: jest.fn() };
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  let service: OmniCoreService;

  const match: FastRuleMatch = {
    ruleId: "fast-rule.default-text-generation",
    intent: "simple-generation",
    confidence: 0.75,
  };

  const plan: CapabilityPlan = {
    planId: "plan-1",
    intent: "simple-generation",
    steps: [{ stepId: "step-1", capability: "text-generation", input: "hi there" }],
  };

  const taskPlan: TaskPlan = {
    taskPlanId: "task-plan-1",
    sourceCapabilityPlanId: "plan-1",
    intent: "simple-generation",
    steps: [
      {
        stepId: "step-1",
        title: "Generate a response",
        description: "Generate a response for the given prompt using the text-generation capability.",
        objective: "Produce a direct response to the user's prompt.",
        capabilities: ["text-generation"],
        inputRequirements: "hi there",
        expectedOutput: "Generated text responding to the prompt.",
        dependsOn: [],
        executionMode: "sequential",
        complexity: "low",
        failurePolicy: { mode: "abort" },
      },
    ],
    stages: [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] }],
    complexity: "low",
  };

  const execution: PlanExecutionResult = {
    taskPlanId: "task-plan-1",
    status: "completed",
    stageResults: [
      {
        stageId: "stage-1",
        status: "completed",
        stepResults: [
          {
            stepId: "step-1",
            status: "completed",
            output: "Hello!",
            providerId: "anthropic",
            modelId: "claude-sonnet-5",
            startedAt: "2026-07-27T00:00:00.000Z",
            completedAt: "2026-07-27T00:00:01.000Z",
            durationMs: 1000,
          },
        ],
        startedAt: "2026-07-27T00:00:00.000Z",
        completedAt: "2026-07-27T00:00:01.000Z",
        durationMs: 1000,
      },
    ],
    startedAt: "2026-07-27T00:00:00.000Z",
    completedAt: "2026-07-27T00:00:01.000Z",
    durationMs: 1000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OmniCoreService(
      fastRules as unknown as FastRulesEngineService,
      planBuilder as unknown as CapabilityPlanBuilderService,
      taskPlanner as unknown as TaskPlannerService,
      orchestrator as unknown as ExecutionOrchestratorService,
      logger as unknown as Logger,
    );
  });

  function mockHappyPath(): void {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue(plan);
    taskPlanner.plan.mockReturnValue(taskPlan);
    orchestrator.execute.mockResolvedValue(execution);
  }

  it("classifies the prompt, then builds a plan from the match", async () => {
    mockHappyPath();

    await service.execute("hi there");

    expect(fastRules.classify).toHaveBeenCalledWith("hi there");
    expect(planBuilder.build).toHaveBeenCalledWith("hi there", match);
  });

  it("builds a task plan from the capability plan, then hands it to the orchestrator", async () => {
    mockHappyPath();

    await service.execute("hi there");

    expect(taskPlanner.plan).toHaveBeenCalledWith(plan);
    expect(orchestrator.execute).toHaveBeenCalledWith(taskPlan);
  });

  it("returns the plan id, intent, matched fast-rule id, confidence, text, providerId, modelId, taskPlan, and execution — nothing else", async () => {
    mockHappyPath();

    const result = await service.execute("hi there");

    expect(result).toEqual({
      planId: "plan-1",
      intent: "simple-generation",
      matchedRuleId: "fast-rule.default-text-generation",
      confidence: 0.75,
      text: "Hello!",
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      taskPlan,
      execution,
    });
  });

  it("derives text/providerId/modelId from the orchestrator's single step result", async () => {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue(plan);
    taskPlanner.plan.mockReturnValue(taskPlan);
    orchestrator.execute.mockResolvedValue({
      ...execution,
      stageResults: [
        {
          ...execution.stageResults[0],
          stepResults: [
            {
              ...execution.stageResults[0]!.stepResults[0],
              output: "A different answer",
              providerId: "gemini",
              modelId: "gemini-2.5-flash",
            },
          ],
        },
      ],
    });

    const result = await service.execute("hi there");

    expect(result.text).toBe("A different answer");
    expect(result.providerId).toBe("gemini");
    expect(result.modelId).toBe("gemini-2.5-flash");
  });

  it("propagates an INTENT_NOT_RECOGNIZED error from the fast-rules engine unchanged", async () => {
    const error = { response: { code: "INTENT_NOT_RECOGNIZED" } };
    fastRules.classify.mockImplementation(() => {
      throw error;
    });

    await expect(service.execute("   ")).rejects.toBe(error);
    expect(planBuilder.build).not.toHaveBeenCalled();
    expect(taskPlanner.plan).not.toHaveBeenCalled();
    expect(orchestrator.execute).not.toHaveBeenCalled();
  });

  it("propagates an AMBIGUOUS_INTENT error from the plan builder unchanged, without a special-cased branch", async () => {
    fastRules.classify.mockReturnValue({
      ruleId: "fast-rule.ambiguous",
      intent: "ambiguous",
      confidence: 0.55,
      alternateIntents: ["code-generation", "summarization"],
    });
    const error = {
      response: { code: "AMBIGUOUS_INTENT", alternateIntents: ["code-generation", "summarization"] },
    };
    planBuilder.build.mockImplementation(() => {
      throw error;
    });

    await expect(service.execute("Summarize this code snippet")).rejects.toBe(error);
    expect(taskPlanner.plan).not.toHaveBeenCalled();
    expect(orchestrator.execute).not.toHaveBeenCalled();
  });

  it("propagates a task-planning domain error from the task planner unchanged, without wrapping it", async () => {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue(plan);
    const error = { response: { code: "CIRCULAR_DEPENDENCY" } };
    taskPlanner.plan.mockImplementation(() => {
      throw error;
    });

    await expect(service.execute("hi there")).rejects.toBe(error);
    expect(orchestrator.execute).not.toHaveBeenCalled();
  });

  it("propagates an orchestration/provider execution error unchanged, without wrapping it", async () => {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue(plan);
    taskPlanner.plan.mockReturnValue(taskPlan);
    const executionError = { response: { code: "PROVIDER_RATE_LIMITED" } };
    orchestrator.execute.mockRejectedValue(executionError);

    await expect(service.execute("hi there")).rejects.toBe(executionError);
  });

  it("throws INVALID_EXECUTION_STATE rather than returning an incomplete response if orchestration resolves without a usable step result", async () => {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue(plan);
    taskPlanner.plan.mockReturnValue(taskPlan);
    orchestrator.execute.mockResolvedValue({ ...execution, stageResults: [] });

    await expect(service.execute("hi there")).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "INVALID_EXECUTION_STATE" }) }),
    );
  });

  it("rejects a plan with zero steps rather than silently doing nothing", async () => {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue({ ...plan, steps: [] });

    await expect(service.execute("hi there")).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "INTENT_NOT_RECOGNIZED" }) }),
    );
    expect(taskPlanner.plan).not.toHaveBeenCalled();
    expect(orchestrator.execute).not.toHaveBeenCalled();
  });

  it("rejects a plan with more than one step rather than silently executing only the first", async () => {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue({
      ...plan,
      steps: [...plan.steps, { stepId: "step-2", capability: "text-generation", input: "second" }],
    });

    await expect(service.execute("hi there")).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "INTENT_NOT_RECOGNIZED" }) }),
    );
    expect(taskPlanner.plan).not.toHaveBeenCalled();
    expect(orchestrator.execute).not.toHaveBeenCalled();
  });

  describe("success-path logging", () => {
    it("logs the plan id, intent, matched fast-rule id, confidence, provider, and model at debug on success", async () => {
      mockHappyPath();

      await service.execute("hi there");

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: "plan-1",
          intent: "simple-generation",
          matchedRuleId: "fast-rule.default-text-generation",
          confidence: 0.75,
          providerId: "anthropic",
          modelId: "claude-sonnet-5",
        }),
        expect.any(String),
      );
    });

    it("never logs anything when classification throws", async () => {
      fastRules.classify.mockImplementation(() => {
        throw { response: { code: "INTENT_NOT_RECOGNIZED" } };
      });

      await expect(service.execute("   ")).rejects.toBeDefined();

      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("never logs anything of its own when orchestration rejects", async () => {
      fastRules.classify.mockReturnValue(match);
      planBuilder.build.mockReturnValue(plan);
      taskPlanner.plan.mockReturnValue(taskPlan);
      orchestrator.execute.mockRejectedValue({ response: { code: "PROVIDER_TIMEOUT" } });

      await expect(service.execute("hi there")).rejects.toBeDefined();

      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("executeStream — Phase 6 Step 2", () => {
    function fakeStream(chunks: readonly string[]): AsyncIterable<string> {
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    }

    function mockStreamingHappyPath(textStream: AsyncIterable<string>): void {
      fastRules.classify.mockReturnValue(match);
      planBuilder.build.mockReturnValue(plan);
      taskPlanner.plan.mockReturnValue(taskPlan);
      orchestrator.executeStream.mockResolvedValue({
        textStream,
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
      });
    }

    it("classifies, builds a plan, and builds a task plan exactly like execute() does", async () => {
      mockStreamingHappyPath(fakeStream(["hi"]));

      await service.executeStream("hi there");

      expect(fastRules.classify).toHaveBeenCalledWith("hi there");
      expect(planBuilder.build).toHaveBeenCalledWith("hi there", match);
      expect(taskPlanner.plan).toHaveBeenCalledWith(plan);
    });

    it("delegates to orchestrator.executeStream (not execute) with the built task plan and forwarded options", async () => {
      mockStreamingHappyPath(fakeStream(["hi"]));
      const controller = new AbortController();

      await service.executeStream("hi there", { signal: controller.signal });

      expect(orchestrator.executeStream).toHaveBeenCalledWith(taskPlan, { signal: controller.signal });
      expect(orchestrator.execute).not.toHaveBeenCalled();
    });

    it("returns planId/intent/matchedRuleId/confidence/providerId/modelId/taskPlan/textStream — nothing else", async () => {
      const textStream = fakeStream(["hi"]);
      mockStreamingHappyPath(textStream);

      const result = await service.executeStream("hi there");

      expect(result).toEqual({
        planId: "plan-1",
        intent: "simple-generation",
        matchedRuleId: "fast-rule.default-text-generation",
        confidence: 0.75,
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
        taskPlan,
        textStream,
      });
    });

    it("resolves before the textStream is iterated — model selection already succeeded", async () => {
      let iterated = false;
      const textStream = (async function* () {
        iterated = true;
        yield "hi";
      })();
      mockStreamingHappyPath(textStream);

      const result = await service.executeStream("hi there");

      expect(iterated).toBe(false);
      for await (const _chunk of result.textStream) {
        // drain
      }
      expect(iterated).toBe(true);
    });

    it("propagates an INTENT_NOT_RECOGNIZED error from the fast-rules engine unchanged", async () => {
      const error = { response: { code: "INTENT_NOT_RECOGNIZED" } };
      fastRules.classify.mockImplementation(() => {
        throw error;
      });

      await expect(service.executeStream("   ")).rejects.toBe(error);
      expect(planBuilder.build).not.toHaveBeenCalled();
      expect(taskPlanner.plan).not.toHaveBeenCalled();
      expect(orchestrator.executeStream).not.toHaveBeenCalled();
    });

    it("propagates an AMBIGUOUS_INTENT error from the plan builder unchanged", async () => {
      fastRules.classify.mockReturnValue({
        ruleId: "fast-rule.ambiguous",
        intent: "ambiguous",
        confidence: 0.55,
        alternateIntents: ["code-generation", "summarization"],
      });
      const error = { response: { code: "AMBIGUOUS_INTENT" } };
      planBuilder.build.mockImplementation(() => {
        throw error;
      });

      await expect(service.executeStream("Summarize this")).rejects.toBe(error);
      expect(taskPlanner.plan).not.toHaveBeenCalled();
      expect(orchestrator.executeStream).not.toHaveBeenCalled();
    });

    it("propagates a task-planning domain error from the task planner unchanged", async () => {
      fastRules.classify.mockReturnValue(match);
      planBuilder.build.mockReturnValue(plan);
      const error = { response: { code: "CIRCULAR_DEPENDENCY" } };
      taskPlanner.plan.mockImplementation(() => {
        throw error;
      });

      await expect(service.executeStream("hi there")).rejects.toBe(error);
      expect(orchestrator.executeStream).not.toHaveBeenCalled();
    });

    it("propagates a model-selection/orchestration error from orchestrator.executeStream unchanged — before any headers a caller might open", async () => {
      fastRules.classify.mockReturnValue(match);
      planBuilder.build.mockReturnValue(plan);
      taskPlanner.plan.mockReturnValue(taskPlan);
      const error = { response: { code: "NO_COMPATIBLE_MODEL" } };
      orchestrator.executeStream.mockRejectedValue(error);

      await expect(service.executeStream("hi there")).rejects.toBe(error);
    });

    it("rejects a plan with zero or multiple steps, same single-step guard as execute()", async () => {
      fastRules.classify.mockReturnValue(match);
      planBuilder.build.mockReturnValue({ ...plan, steps: [] });

      await expect(service.executeStream("hi there")).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "INTENT_NOT_RECOGNIZED" }) }),
      );
      expect(taskPlanner.plan).not.toHaveBeenCalled();
      expect(orchestrator.executeStream).not.toHaveBeenCalled();
    });
  });
});
