import { describe, expect, it } from "vitest";
import {
  capabilityValues,
  capabilitySchema,
  generateTextRequestSchema,
  listModelsQuerySchema,
} from "./ai-provider";

describe("capabilitySchema", () => {
  it("accepts every declared capability value", () => {
    for (const value of capabilityValues) {
      expect(capabilitySchema.parse(value)).toBe(value);
    }
  });

  it("rejects an unknown capability", () => {
    expect(() => capabilitySchema.parse("time-travel")).toThrow();
  });
});

describe("listModelsQuerySchema", () => {
  it("accepts an empty query, leaving both filters undefined", () => {
    expect(listModelsQuerySchema.parse({})).toEqual({});
  });

  it("accepts a valid capability filter", () => {
    expect(listModelsQuerySchema.parse({ capability: "vision" })).toEqual({
      capability: "vision",
    });
  });

  it("rejects an invalid capability filter", () => {
    expect(() => listModelsQuerySchema.parse({ capability: "not-a-capability" })).toThrow();
  });

  it("accepts a provider filter, trimmed", () => {
    expect(listModelsQuerySchema.parse({ provider: "  gemini  " })).toEqual({
      provider: "gemini",
    });
  });

  it("rejects an empty provider filter", () => {
    expect(() => listModelsQuerySchema.parse({ provider: "   " })).toThrow();
  });

  it("rejects unknown query params", () => {
    expect(() => listModelsQuerySchema.parse({ capability: "vision", limit: "10" })).toThrow();
  });
});

describe("generateTextRequestSchema", () => {
  it("accepts a valid prompt", () => {
    expect(generateTextRequestSchema.parse({ prompt: "Hello there" })).toEqual({
      prompt: "Hello there",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(generateTextRequestSchema.parse({ prompt: "  Hello there  " })).toEqual({
      prompt: "Hello there",
    });
  });

  it("rejects an empty prompt", () => {
    expect(() => generateTextRequestSchema.parse({ prompt: "" })).toThrow();
  });

  it("rejects a whitespace-only prompt", () => {
    expect(() => generateTextRequestSchema.parse({ prompt: "   " })).toThrow();
  });

  it("rejects a prompt over 8000 characters", () => {
    expect(() => generateTextRequestSchema.parse({ prompt: "a".repeat(8_001) })).toThrow();
  });

  it("accepts a prompt of exactly 8000 characters", () => {
    const prompt = "a".repeat(8_000);
    expect(generateTextRequestSchema.parse({ prompt })).toEqual({ prompt });
  });

  it("rejects a missing prompt", () => {
    expect(() => generateTextRequestSchema.parse({})).toThrow();
  });

  it("rejects unknown fields, including internal routing fields", () => {
    expect(() =>
      generateTextRequestSchema.parse({ prompt: "hi", requiredCapabilities: ["text-generation"] }),
    ).toThrow();
    expect(() =>
      generateTextRequestSchema.parse({ prompt: "hi", preferredProviderId: "anthropic" }),
    ).toThrow();
    expect(() =>
      generateTextRequestSchema.parse({ prompt: "hi", preferredModelId: "claude-sonnet-5" }),
    ).toThrow();
  });
});
