import { describe, expect, it } from "vitest";
import type { ToolExecutionResult, ToolMetadata } from "./tool";

describe("tool type shapes", () => {
  it("builds a valid ToolMetadata value", () => {
    const metadata: ToolMetadata = {
      id: "echo",
      name: "Echo",
      description: "Returns the supplied input unchanged.",
      capabilities: ["utility"],
    };

    expect(metadata.id).toBe("echo");
    expect(metadata.capabilities).toContain("utility");
  });

  it("builds a valid completed ToolExecutionResult carrying an arbitrary output shape", () => {
    const result: ToolExecutionResult = {
      toolId: "uuid",
      status: "completed",
      output: { uuid: "11111111-1111-1111-1111-111111111111" },
      startedAt: "2026-07-27T00:00:00.000Z",
      completedAt: "2026-07-27T00:00:01.000Z",
      durationMs: 1000,
    };

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ uuid: "11111111-1111-1111-1111-111111111111" });
  });

  it("builds a valid failed ToolExecutionResult carrying an errorCode instead of output", () => {
    const result: ToolExecutionResult = {
      toolId: "echo",
      status: "failed",
      errorCode: "INVALID_TOOL_INPUT",
      startedAt: "2026-07-27T00:00:00.000Z",
    };

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("INVALID_TOOL_INPUT");
    expect(result.output).toBeUndefined();
  });
});
