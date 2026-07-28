import { EchoTool } from "./echo.tool";

describe("EchoTool", () => {
  let tool: EchoTool;

  beforeEach(() => {
    tool = new EchoTool();
  });

  it("exposes its metadata", () => {
    expect(tool.id).toBe("echo");
    expect(tool.name.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.capabilities).toContain("utility");
  });

  it("returns its input unchanged", async () => {
    await expect(tool.execute("hello")).resolves.toBe("hello");
    await expect(tool.execute("")).resolves.toBe("");
  });

  it("accepts a string via its input schema", () => {
    expect(tool.inputSchema.safeParse("hello")).toEqual({ success: true, data: "hello" });
  });

  it("rejects a non-string via its input schema", () => {
    const result = tool.inputSchema.safeParse({ not: "a string" });
    expect(result.success).toBe(false);
  });

  it("accepts a string via its output schema", () => {
    expect(tool.outputSchema.safeParse("hello")).toEqual({ success: true, data: "hello" });
  });
});
