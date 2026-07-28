import type { TaskPlanStep } from "@omniscience/types";
import { StepExecutorService } from "./step-executor.service";

describe("StepExecutorService", () => {
  const selector = { select: jest.fn() };
  const registry = { getById: jest.fn() };
  let service: StepExecutorService;

  function stepFixture(overrides: Partial<TaskPlanStep> = {}): TaskPlanStep {
    return {
      stepId: "step-1",
      title: "Generate a response",
      description: "Generate a response for the given prompt.",
      objective: "Produce a direct response to the user's prompt.",
      capabilities: ["text-generation"],
      inputRequirements: "hi there",
      expectedOutput: "Generated text responding to the prompt.",
      dependsOn: [],
      executionMode: "sequential",
      complexity: "low",
      failurePolicy: { mode: "abort" },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StepExecutorService(selector as never, registry as never);
  });

  function mockHappyPath(generateText: jest.Mock): void {
    selector.select.mockReturnValue({
      model: { providerId: "anthropic", modelId: "claude-sonnet-5" },
      matchedRule: "priority-fallback",
    });
    registry.getById.mockReturnValue({ generateText });
  }

  it("selects a model for the step's capabilities and calls generateText with the step's input", async () => {
    const generateText = jest.fn().mockResolvedValue("Hello!");
    mockHappyPath(generateText);

    const result = await service.execute(stepFixture());

    expect(selector.select).toHaveBeenCalledWith({ requiredCapabilities: ["text-generation"] });
    expect(registry.getById).toHaveBeenCalledWith("anthropic");
    expect(generateText).toHaveBeenCalledWith("claude-sonnet-5", "hi there");
    expect(result).toEqual({ output: "Hello!", providerId: "anthropic", modelId: "claude-sonnet-5" });
  });

  it("throws UNSUPPORTED_CAPABILITY for a step requiring a capability this phase cannot execute", async () => {
    await expect(service.execute(stepFixture({ capabilities: ["vision"] }))).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY" }) }),
    );
    expect(selector.select).not.toHaveBeenCalled();
  });

  it("propagates a NO_COMPATIBLE_MODEL error from the selector unchanged", async () => {
    const error = { response: { code: "NO_COMPATIBLE_MODEL" } };
    selector.select.mockImplementation(() => {
      throw error;
    });

    await expect(service.execute(stepFixture())).rejects.toBe(error);
  });

  it("propagates a provider error unchanged, without wrapping it", async () => {
    const providerError = { response: { code: "PROVIDER_RATE_LIMITED" } };
    mockHappyPath(jest.fn().mockRejectedValue(providerError));

    await expect(service.execute(stepFixture())).rejects.toBe(providerError);
  });

  it("throws EXECUTION_CANCELLED immediately if the signal is already aborted", async () => {
    mockHappyPath(jest.fn().mockResolvedValue("Hello!"));
    const controller = new AbortController();
    controller.abort();

    await expect(service.execute(stepFixture(), { signal: controller.signal })).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "EXECUTION_CANCELLED" }) }),
    );
    expect(selector.select).not.toHaveBeenCalled();
  });

  it("throws EXECUTION_CANCELLED if the signal aborts while the provider call is in flight", async () => {
    const controller = new AbortController();
    const generateText = jest.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("too late"), 50)),
    );
    mockHappyPath(generateText);

    const promise = service.execute(stepFixture(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "EXECUTION_CANCELLED" }) }),
    );
  });

  it("throws EXECUTION_TIMEOUT if the provider call exceeds the configured timeout", async () => {
    const generateText = jest.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("too late"), 50)),
    );
    mockHappyPath(generateText);

    await expect(service.execute(stepFixture(), { timeoutMs: 5 })).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "EXECUTION_TIMEOUT" }) }),
    );
  });

  it("resolves normally when the provider call finishes before the configured timeout", async () => {
    mockHappyPath(jest.fn().mockResolvedValue("Hello!"));

    const result = await service.execute(stepFixture(), { timeoutMs: 1000 });

    expect(result.output).toBe("Hello!");
  });
});
