import { UUIDTool } from "./uuid.tool";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("UUIDTool", () => {
  let tool: UUIDTool;

  beforeEach(() => {
    tool = new UUIDTool();
  });

  it("exposes its metadata", () => {
    expect(tool.id).toBe("uuid");
    expect(tool.name.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.capabilities).toContain("utility");
  });

  it("generates a valid v4 UUID", async () => {
    const result = await tool.execute();
    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it("generates a different UUID on every call", async () => {
    const first = await tool.execute();
    const second = await tool.execute();
    expect(first).not.toBe(second);
  });

  it("accepts any input via its input schema", () => {
    expect(tool.inputSchema.safeParse(undefined)).toEqual({ success: true, data: undefined });
  });

  it("accepts a string via its output schema", () => {
    const result = tool.outputSchema.safeParse("11111111-1111-4111-8111-111111111111");
    expect(result.success).toBe(true);
  });
});
