import { CurrentTimeTool } from "./current-time.tool";

describe("CurrentTimeTool", () => {
  let tool: CurrentTimeTool;

  beforeEach(() => {
    tool = new CurrentTimeTool();
  });

  it("exposes its metadata", () => {
    expect(tool.id).toBe("current-time");
    expect(tool.name.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.capabilities).toContain("utility");
  });

  it("returns the current UTC timestamp as an ISO 8601 string", async () => {
    const before = Date.now();
    const result = await tool.execute();
    const after = Date.now();

    const parsed = new Date(result).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
    expect(result).toBe(new Date(parsed).toISOString());
  });

  it("accepts any input, including undefined, via its input schema", () => {
    expect(tool.inputSchema.safeParse(undefined)).toEqual({ success: true, data: undefined });
    expect(tool.inputSchema.safeParse("anything")).toEqual({ success: true, data: "anything" });
  });

  it("accepts a string via its output schema", () => {
    const result = tool.outputSchema.safeParse("2026-07-27T00:00:00.000Z");
    expect(result.success).toBe(true);
  });
});
