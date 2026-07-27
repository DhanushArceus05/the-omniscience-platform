import type { Logger } from "pino";
import type {
  CapabilityPlan,
  FastRuleMatch,
  ModelMetadata,
  ModelSelectionResult,
  TaskPlan,
} from "@omniscience/types";
import { ModelSelectorService } from "../ai/model-selector.service";
import { ProviderRegistryService } from "../ai/provider-registry.service";
import { CapabilityPlanBuilderService } from "./capability-plan-builder.service";
import { FastRulesEngineService } from "./fast-rules-engine.service";
import { OmniCoreService } from "./omnicore.service";
import { TaskPlannerService } from "./task-planner.service";

describe("OmniCoreService", () => {
  const fastRules = { classify: jest.fn() };
  const planBuilder = { build: jest.fn() };
  const taskPlanner = { plan: jest.fn() };
  const selector = { select: jest.fn() };
  const registry = { getById: jest.fn() };
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

  const model: ModelMetadata = {
    providerId: "anthropic",
    modelId: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    capabilities: ["text-generation"],
    availability: "available",
    priority: 15,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OmniCoreService(
      fastRules as unknown as FastRulesEngineService,
      planBuilder as unknown as CapabilityPlanBuilderService,
      taskPlanner as unknown as TaskPlannerService,
      selector as unknown as ModelSelectorService,
      registry as unknown as ProviderRegistryService,
      logger as unknown as Logger,
    );
  });

  function mockHappyPath(): { generateText: jest.Mock } {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue(plan);
    taskPlanner.plan.mockReturnValue(taskPlan);
    const selection: ModelSelectionResult = { model, matchedRule: "priority-fallback" };
    selector.select.mockReturnValue(selection);
    const generateText = jest.fn().mockResolvedValue("Hello!");
    registry.getById.mockReturnValue({ generateText });
    return { generateText };
  }

  it("classifies the prompt, then builds a plan from the match", async () => {
    mockHappyPath();

    await service.execute("hi there");

    expect(fastRules.classify).toHaveBeenCalledWith("hi there");
    expect(planBuilder.build).toHaveBeenCalledWith("hi there", match);
  });

  it("builds a task plan from the capability plan before selecting a model", async () => {
    mockHappyPath();

    await service.execute("hi there");

    expect(taskPlanner.plan).toHaveBeenCalledWith(plan);
    const taskPlannerCallOrder = taskPlanner.plan.mock.invocationCallOrder[0];
    const selectorCallOrder = selector.select.mock.invocationCallOrder[0];
    expect(taskPlannerCallOrder).toBeLessThan(selectorCallOrder as number);
  });

  it("requests a model selection using the plan step's capability", async () => {
    mockHappyPath();

    await service.execute("hi there");

    expect(selector.select).toHaveBeenCalledWith({ requiredCapabilities: ["text-generation"] });
  });

  it("looks up the selected model's provider and calls generateText with the selected model id and the step's input", async () => {
    const { generateText } = mockHappyPath();

    await service.execute("hi there");

    expect(registry.getById).toHaveBeenCalledWith("anthropic");
    expect(generateText).toHaveBeenCalledWith("claude-sonnet-5", "hi there");
  });

  it("returns the plan id, intent, matched fast-rule id, confidence, text, providerId, modelId, and taskPlan — nothing else", async () => {
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
    });
  });

  it("propagates an INTENT_NOT_RECOGNIZED error from the fast-rules engine unchanged", async () => {
    const error = { response: { code: "INTENT_NOT_RECOGNIZED" } };
    fastRules.classify.mockImplementation(() => {
      throw error;
    });

    await expect(service.execute("   ")).rejects.toBe(error);
    expect(planBuilder.build).not.toHaveBeenCalled();
    expect(taskPlanner.plan).not.toHaveBeenCalled();
    expect(selector.select).not.toHaveBeenCalled();
  });

  it("propagates a NO_COMPATIBLE_MODEL error from the selector unchanged", async () => {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue(plan);
    taskPlanner.plan.mockReturnValue(taskPlan);
    const error = { response: { code: "NO_COMPATIBLE_MODEL" } };
    selector.select.mockImplementation(() => {
      throw error;
    });

    await expect(service.execute("hi there")).rejects.toBe(error);
    expect(registry.getById).not.toHaveBeenCalled();
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
    expect(selector.select).not.toHaveBeenCalled();
  });

  it("propagates a task-planning domain error from the task planner unchanged, without wrapping it", async () => {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue(plan);
    const error = { response: { code: "CIRCULAR_DEPENDENCY" } };
    taskPlanner.plan.mockImplementation(() => {
      throw error;
    });

    await expect(service.execute("hi there")).rejects.toBe(error);
    expect(selector.select).not.toHaveBeenCalled();
  });

  it("propagates a provider execution error unchanged, without wrapping it", async () => {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue(plan);
    taskPlanner.plan.mockReturnValue(taskPlan);
    const selection: ModelSelectionResult = { model, matchedRule: "priority-fallback" };
    selector.select.mockReturnValue(selection);
    const providerError = { response: { code: "PROVIDER_RATE_LIMITED" } };
    registry.getById.mockReturnValue({
      generateText: jest.fn().mockRejectedValue(providerError),
    });

    await expect(service.execute("hi there")).rejects.toBe(providerError);
  });

  it("rejects a plan with zero steps rather than silently doing nothing", async () => {
    fastRules.classify.mockReturnValue(match);
    planBuilder.build.mockReturnValue({ ...plan, steps: [] });

    await expect(service.execute("hi there")).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "INTENT_NOT_RECOGNIZED" }) }),
    );
    expect(taskPlanner.plan).not.toHaveBeenCalled();
    expect(selector.select).not.toHaveBeenCalled();
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
    expect(selector.select).not.toHaveBeenCalled();
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

    it("never logs anything when the provider's generateText rejects", async () => {
      fastRules.classify.mockReturnValue(match);
      planBuilder.build.mockReturnValue(plan);
      taskPlanner.plan.mockReturnValue(taskPlan);
      const selection: ModelSelectionResult = { model, matchedRule: "priority-fallback" };
      selector.select.mockReturnValue(selection);
      registry.getById.mockReturnValue({
        generateText: jest.fn().mockRejectedValue({ response: { code: "PROVIDER_TIMEOUT" } }),
      });

      await expect(service.execute("hi there")).rejects.toBeDefined();

      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
