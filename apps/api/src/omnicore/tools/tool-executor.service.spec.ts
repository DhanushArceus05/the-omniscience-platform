import type { Tool } from "./tool.interface";
import { anyInputSchema, stringSchema } from "./tool.interface";
import { ToolExecutorService } from "./tool-executor.service";
import { ToolRegistryService } from "./tool-registry.service";

describe("ToolExecutorService", () => {
  let registry: ToolRegistryService;
  let service: ToolExecutorService;

  beforeEach(() => {
    registry = new ToolRegistryService();
    service = new ToolExecutorService(registry);
  });

  function registerEchoLikeTool(execute: jest.Mock): void {
    const tool: Tool<string, string> = {
      id: "echo",
      name: "Echo",
      description: "Returns the supplied input unchanged.",
      capabilities: ["utility"],
      inputSchema: stringSchema,
      outputSchema: stringSchema,
      execute,
    };
    registry.register(tool);
  }

  it("resolves the tool by id, validates input, runs it, and returns a completed result", async () => {
    registerEchoLikeTool(jest.fn().mockResolvedValue("hi there"));

    const result = await service.execute("echo", "hi there");

    expect(result.toolId).toBe("echo");
    expect(result.status).toBe("completed");
    expect(result.output).toBe("hi there");
    expect(result.startedAt).toEqual(expect.any(String));
    expect(result.completedAt).toEqual(expect.any(String));
    expect(typeof result.durationMs).toBe("number");
  });

  it("throws TOOL_NOT_FOUND for an unregistered tool id, never executing anything", async () => {
    await expect(service.execute("missing-tool", "input")).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "TOOL_NOT_FOUND" }) }),
    );
  });

  it("throws INVALID_TOOL_INPUT when the tool's input schema rejects the payload", async () => {
    const execute = jest.fn();
    registerEchoLikeTool(execute);

    await expect(service.execute("echo", { not: "a string" })).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "INVALID_TOOL_INPUT" }) }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("wraps a plain thrown error from the tool's own execute() as TOOL_EXECUTION_FAILED", async () => {
    registerEchoLikeTool(jest.fn().mockRejectedValue(new Error("boom")));

    await expect(service.execute("echo", "hi there")).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "TOOL_EXECUTION_FAILED" }) }),
    );
  });

  it("propagates an HttpException a tool throws itself unchanged, without re-wrapping it", async () => {
    const { HttpException, HttpStatus } = await import("@nestjs/common");
    const toolError = new HttpException({ code: "CUSTOM_TOOL_ERROR" }, HttpStatus.CONFLICT);
    registerEchoLikeTool(jest.fn().mockRejectedValue(toolError));

    await expect(service.execute("echo", "hi there")).rejects.toBe(toolError);
  });

  it("throws TOOL_EXECUTION_FAILED when the tool's result fails its own output schema", async () => {
    const tool: Tool<string, string> = {
      id: "misbehaving",
      name: "Misbehaving Tool",
      description: "Declares a string output but returns something else.",
      capabilities: ["utility"],
      inputSchema: anyInputSchema as never,
      outputSchema: stringSchema,
      execute: jest.fn().mockResolvedValue({ not: "a string" }),
    };
    registry.register(tool);

    await expect(service.execute("misbehaving", "anything")).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "TOOL_EXECUTION_FAILED" }) }),
    );
  });

  it("throws TOOL_CANCELLED immediately if the signal is already aborted", async () => {
    registerEchoLikeTool(jest.fn().mockResolvedValue("hi there"));
    const controller = new AbortController();
    controller.abort();

    await expect(service.execute("echo", "hi there", { signal: controller.signal })).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "TOOL_CANCELLED" }) }),
    );
  });

  it("throws TOOL_CANCELLED if the signal aborts while the tool call is in flight", async () => {
    const controller = new AbortController();
    registerEchoLikeTool(
      jest.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("too late"), 50))),
    );

    const promise = service.execute("echo", "hi there", { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "TOOL_CANCELLED" }) }),
    );
  });

  it("throws TOOL_TIMEOUT if the tool call exceeds the configured timeout", async () => {
    registerEchoLikeTool(
      jest.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("too late"), 50))),
    );

    await expect(service.execute("echo", "hi there", { timeoutMs: 5 })).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "TOOL_TIMEOUT" }) }),
    );
  });

  it("resolves normally when the tool call finishes before the configured timeout", async () => {
    registerEchoLikeTool(jest.fn().mockResolvedValue("hi there"));

    const result = await service.execute("echo", "hi there", { timeoutMs: 1000 });

    expect(result.output).toBe("hi there");
  });
});
