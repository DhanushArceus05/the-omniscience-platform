import type { Tool } from "./tool.interface";
import { stringSchema } from "./tool.interface";
import { ToolRegistryService } from "./tool-registry.service";

describe("ToolRegistryService", () => {
  let service: ToolRegistryService;

  function toolFixture(id: string): Tool<string, string> {
    return {
      id,
      name: `Tool ${id}`,
      description: `A test tool named ${id}.`,
      capabilities: ["utility"],
      inputSchema: stringSchema,
      outputSchema: stringSchema,
      execute: jest.fn().mockResolvedValue("ok"),
    };
  }

  beforeEach(() => {
    service = new ToolRegistryService();
  });

  it("registers a tool and resolves it by id", () => {
    const tool = toolFixture("echo");

    service.register(tool);

    expect(service.getById("echo")).toBe(tool);
  });

  it("throws TOOL_NOT_FOUND when resolving an unregistered id", () => {
    expect(() => service.getById("missing")).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "TOOL_NOT_FOUND" }) }),
    );
  });

  it("tryGetById returns undefined instead of throwing for an unregistered id", () => {
    expect(service.tryGetById("missing")).toBeUndefined();
  });

  it("tryGetById returns the tool once registered", () => {
    const tool = toolFixture("uuid");
    service.register(tool);

    expect(service.tryGetById("uuid")).toBe(tool);
  });

  it("throws DUPLICATE_TOOL_ID when registering the same id twice", () => {
    service.register(toolFixture("echo"));

    expect(() => service.register(toolFixture("echo"))).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "DUPLICATE_TOOL_ID" }) }),
    );
  });

  it("list() returns every registered tool, in registration order", () => {
    const first = toolFixture("echo");
    const second = toolFixture("uuid");
    service.register(first);
    service.register(second);

    expect(service.list()).toEqual([first, second]);
  });

  it("list() returns an empty array when nothing is registered", () => {
    expect(service.list()).toEqual([]);
  });
});
