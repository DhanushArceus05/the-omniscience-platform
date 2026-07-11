import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

describe("createLogger", () => {
  it("creates a pino logger tagged with the service name", () => {
    const logger = createLogger({ service: "api" });
    expect(logger.bindings()["service"]).toBe("api");
  });

  it("defaults to info level when not specified", () => {
    const logger = createLogger({ service: "ai-service" });
    expect(logger.level).toBe("info");
  });

  it("respects an explicit log level", () => {
    const logger = createLogger({ service: "web", level: "debug" });
    expect(logger.level).toBe("debug");
  });
});
