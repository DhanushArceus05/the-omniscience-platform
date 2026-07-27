import { describe, expect, it } from "vitest";
import { omniCoreExecuteRequestSchema } from "./omnicore";

describe("omniCoreExecuteRequestSchema", () => {
  it("accepts a valid prompt", () => {
    expect(omniCoreExecuteRequestSchema.parse({ prompt: "Hello there" })).toEqual({
      prompt: "Hello there",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(omniCoreExecuteRequestSchema.parse({ prompt: "  Hello there  " })).toEqual({
      prompt: "Hello there",
    });
  });

  it("rejects an empty prompt", () => {
    expect(() => omniCoreExecuteRequestSchema.parse({ prompt: "" })).toThrow();
  });

  it("rejects a whitespace-only prompt", () => {
    expect(() => omniCoreExecuteRequestSchema.parse({ prompt: "   " })).toThrow();
  });

  it("rejects a prompt over 8000 characters", () => {
    expect(() => omniCoreExecuteRequestSchema.parse({ prompt: "a".repeat(8_001) })).toThrow();
  });

  it("accepts a prompt of exactly 8000 characters", () => {
    const prompt = "a".repeat(8_000);
    expect(omniCoreExecuteRequestSchema.parse({ prompt })).toEqual({ prompt });
  });

  it("rejects a missing prompt", () => {
    expect(() => omniCoreExecuteRequestSchema.parse({})).toThrow();
  });

  it("rejects unknown fields, including a caller-supplied intent or plan", () => {
    expect(() => omniCoreExecuteRequestSchema.parse({ prompt: "hi", intent: "simple-generation" })).toThrow();
    expect(() => omniCoreExecuteRequestSchema.parse({ prompt: "hi", plan: { steps: [] } })).toThrow();
  });
});
