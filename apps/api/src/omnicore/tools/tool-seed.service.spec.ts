import type { Logger } from "pino";
import { CurrentTimeTool } from "./built-in/current-time.tool";
import { EchoTool } from "./built-in/echo.tool";
import { UUIDTool } from "./built-in/uuid.tool";
import { ToolRegistryService } from "./tool-registry.service";
import { ToolSeedService } from "./tool-seed.service";

function makeLogger(): Logger {
  return { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } as unknown as Logger;
}

describe("ToolSeedService", () => {
  it("registers every built-in tool into the registry exactly once", () => {
    const registry = new ToolRegistryService();
    const logger = makeLogger();

    new ToolSeedService(registry, new EchoTool(), new CurrentTimeTool(), new UUIDTool(), logger).onModuleInit();

    expect(registry.list().map((tool) => tool.id).sort()).toEqual(["current-time", "echo", "uuid"]);
  });

  it("logs an info-level registry-seeded summary listing every registered tool id", () => {
    const registry = new ToolRegistryService();
    const logger = makeLogger();

    new ToolSeedService(registry, new EchoTool(), new CurrentTimeTool(), new UUIDTool(), logger).onModuleInit();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ toolIds: expect.arrayContaining(["echo", "current-time", "uuid"]) }),
      expect.stringContaining("seeded"),
    );
  });

  it("throws DUPLICATE_TOOL_ID if onModuleInit somehow ran twice against the same registry", () => {
    const registry = new ToolRegistryService();
    const logger = makeLogger();
    const service = new ToolSeedService(registry, new EchoTool(), new CurrentTimeTool(), new UUIDTool(), logger);

    service.onModuleInit();

    expect(() => service.onModuleInit()).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "DUPLICATE_TOOL_ID" }) }),
    );
  });
});
