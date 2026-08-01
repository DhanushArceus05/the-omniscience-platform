import type { TaskPlanStep } from "@omniscience/types";
import { StepExecutorService } from "./step-executor.service";

describe("StepExecutorService", () => {
  const selector = { select: jest.fn() };
  const registry = { getById: jest.fn() };
  const toolExecutor = { execute: jest.fn() };
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
    service = new StepExecutorService(selector as never, registry as never, toolExecutor as never);
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

  it("never touches the tool executor when the step is model-routed (toolCategory unset)", async () => {
    mockHappyPath(jest.fn().mockResolvedValue("Hello!"));

    await service.execute(stepFixture());

    expect(toolExecutor.execute).not.toHaveBeenCalled();
  });

  describe("tool-routed steps (toolCategory set)", () => {
    it("routes through the tool executor instead of the model path, using toolCategory as the tool id", async () => {
      toolExecutor.execute.mockResolvedValue({
        toolId: "echo",
        status: "completed",
        output: "hi there",
        startedAt: "2026-07-27T00:00:00.000Z",
        completedAt: "2026-07-27T00:00:01.000Z",
        durationMs: 1000,
      });

      const result = await service.execute(stepFixture({ toolCategory: "echo" }));

      expect(toolExecutor.execute).toHaveBeenCalledWith("echo", "hi there", {});
      expect(selector.select).not.toHaveBeenCalled();
      expect(registry.getById).not.toHaveBeenCalled();
      expect(result).toEqual({ output: JSON.stringify("hi there"), toolId: "echo" });
    });

    it("forwards timeout/signal options to the tool executor", async () => {
      toolExecutor.execute.mockResolvedValue({
        toolId: "uuid",
        status: "completed",
        output: "11111111-1111-1111-1111-111111111111",
        startedAt: "2026-07-27T00:00:00.000Z",
      });
      const controller = new AbortController();

      await service.execute(stepFixture({ toolCategory: "uuid" }), { timeoutMs: 500, signal: controller.signal });

      expect(toolExecutor.execute).toHaveBeenCalledWith("uuid", "hi there", {
        timeoutMs: 500,
        signal: controller.signal,
      });
    });

    it("propagates a TOOL_NOT_FOUND error from the tool executor unchanged", async () => {
      const error = { response: { code: "TOOL_NOT_FOUND" } };
      toolExecutor.execute.mockRejectedValue(error);

      await expect(service.execute(stepFixture({ toolCategory: "unknown-tool" }))).rejects.toBe(error);
    });

    it("propagates an INVALID_TOOL_INPUT error from the tool executor unchanged", async () => {
      const error = { response: { code: "INVALID_TOOL_INPUT" } };
      toolExecutor.execute.mockRejectedValue(error);

      await expect(service.execute(stepFixture({ toolCategory: "echo" }))).rejects.toBe(error);
    });
  });

  describe("executeStream — Phase 6 Step 2", () => {
    async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
      const results: T[] = [];
      for await (const item of iterable) {
        results.push(item);
      }
      return results;
    }

    function fakeStream(chunks: readonly string[]): AsyncIterable<string> {
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    }

    it("throws UNSUPPORTED_CAPABILITY for a step requiring a capability this phase cannot execute, and never selects a model", async () => {
      await expect(service.executeStream(stepFixture({ capabilities: ["vision"] }))).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY" }) }),
      );
      expect(selector.select).not.toHaveBeenCalled();
    });

    it("throws UNSUPPORTED_CAPABILITY for a tool-routed step — streaming does not support tools", async () => {
      await expect(service.executeStream(stepFixture({ toolCategory: "echo" }))).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "UNSUPPORTED_CAPABILITY" }) }),
      );
      expect(toolExecutor.execute).not.toHaveBeenCalled();
      expect(selector.select).not.toHaveBeenCalled();
    });

    it("throws EXECUTION_CANCELLED immediately if the signal is already aborted, and never selects a model", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(service.executeStream(stepFixture(), { signal: controller.signal })).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "EXECUTION_CANCELLED" }) }),
      );
      expect(selector.select).not.toHaveBeenCalled();
    });

    it("resolves model selection eagerly — before the returned textStream is ever iterated", async () => {
      const generateTextStream = jest.fn().mockReturnValue(fakeStream(["hi"]));
      selector.select.mockReturnValue({
        model: { providerId: "anthropic", modelId: "claude-sonnet-5" },
        matchedRule: "priority-fallback",
      });
      registry.getById.mockReturnValue({ generateTextStream });

      const output = await service.executeStream(stepFixture());

      // Model selection already happened as part of the awaited promise
      // above — the provider itself has not been called yet, because
      // nothing has iterated `output.textStream` yet.
      expect(selector.select).toHaveBeenCalledWith({ requiredCapabilities: ["text-generation"] });
      expect(output.providerId).toBe("anthropic");
      expect(output.modelId).toBe("claude-sonnet-5");
      expect(generateTextStream).not.toHaveBeenCalled();

      await collect(output.textStream);
      expect(generateTextStream).toHaveBeenCalledWith("claude-sonnet-5", "hi there", { signal: undefined });
    });

    it("yields every chunk from a provider that implements generateTextStream, in order", async () => {
      const generateTextStream = jest.fn().mockReturnValue(fakeStream(["Hel", "lo!"]));
      selector.select.mockReturnValue({
        model: { providerId: "anthropic", modelId: "claude-sonnet-5" },
        matchedRule: "priority-fallback",
      });
      registry.getById.mockReturnValue({ generateTextStream });

      const output = await service.executeStream(stepFixture());
      const chunks = await collect(output.textStream);

      expect(chunks).toEqual(["Hel", "lo!"]);
    });

    it("falls back to generateText, emitting its complete result as a single chunk, when the provider has no generateTextStream", async () => {
      const generateText = jest.fn().mockResolvedValue("Complete non-streaming response.");
      selector.select.mockReturnValue({
        model: { providerId: "openai", modelId: "gpt-4o" },
        matchedRule: "priority-fallback",
      });
      registry.getById.mockReturnValue({ generateText });

      const output = await service.executeStream(stepFixture());
      const chunks = await collect(output.textStream);

      expect(chunks).toEqual(["Complete non-streaming response."]);
      expect(generateText).toHaveBeenCalledWith("gpt-4o", "hi there");
    });

    it("propagates a non-cancellation provider error unchanged while iterating a real stream", async () => {
      const providerError = { response: { code: "PROVIDER_RATE_LIMITED" } };
      const generateTextStream = jest.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield "partial ";
          throw providerError;
        },
      });
      selector.select.mockReturnValue({
        model: { providerId: "anthropic", modelId: "claude-sonnet-5" },
        matchedRule: "priority-fallback",
      });
      registry.getById.mockReturnValue({ generateTextStream });

      const output = await service.executeStream(stepFixture());

      await expect(collect(output.textStream)).rejects.toBe(providerError);
    });

    it("normalizes a mid-stream failure to EXECUTION_CANCELLED when the signal is aborted at that point", async () => {
      const controller = new AbortController();
      const generateTextStream = jest.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield "partial ";
          controller.abort();
          throw new DOMException("The operation was aborted.", "AbortError");
        },
      });
      selector.select.mockReturnValue({
        model: { providerId: "anthropic", modelId: "claude-sonnet-5" },
        matchedRule: "priority-fallback",
      });
      registry.getById.mockReturnValue({ generateTextStream });

      const output = await service.executeStream(stepFixture(), { signal: controller.signal });

      await expect(collect(output.textStream)).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "EXECUTION_CANCELLED" }) }),
      );
    });

    it("cancellation propagates through the same AbortSignal reference into generateTextStream", async () => {
      const controller = new AbortController();
      const generateTextStream = jest.fn().mockReturnValue(fakeStream(["hi"]));
      selector.select.mockReturnValue({
        model: { providerId: "anthropic", modelId: "claude-sonnet-5" },
        matchedRule: "priority-fallback",
      });
      registry.getById.mockReturnValue({ generateTextStream });

      const output = await service.executeStream(stepFixture(), { signal: controller.signal });
      await collect(output.textStream);

      expect(generateTextStream).toHaveBeenCalledWith("claude-sonnet-5", "hi there", {
        signal: controller.signal,
      });
    });
  });
});
