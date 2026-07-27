import { FastRulesEngineService } from "./fast-rules-engine.service";

describe("FastRulesEngineService", () => {
  let service: FastRulesEngineService;

  beforeEach(() => {
    service = new FastRulesEngineService();
  });

  it("classifies a normal-length prompt as simple-generation via the default rule", () => {
    const result = service.classify("Write a haiku about the ocean");

    expect(result).toEqual({
      ruleId: "fast-rule.default-text-generation",
      intent: "simple-generation",
      confidence: 0.75,
    });
  });

  it("classifies a trivially short prompt via the trivial-prompt rule, at lower confidence", () => {
    const result = service.classify("hi");

    expect(result).toEqual({
      ruleId: "fast-rule.trivial-prompt",
      intent: "simple-generation",
      confidence: 0.35,
    });
  });

  it("trims the prompt before classifying it", () => {
    const trivial = service.classify("   hi   ");
    expect(trivial.ruleId).toBe("fast-rule.trivial-prompt");

    const normal = service.classify("   Write a haiku about the ocean   ");
    expect(normal.ruleId).toBe("fast-rule.default-text-generation");
  });

  it("treats a prompt of exactly the trivial-length threshold as trivial", () => {
    const result = service.classify("abc");
    expect(result.ruleId).toBe("fast-rule.trivial-prompt");
  });

  it("treats a prompt one character over the trivial-length threshold as the default rule", () => {
    const result = service.classify("abcd");
    expect(result.ruleId).toBe("fast-rule.default-text-generation");
  });

  it("throws INTENT_NOT_RECOGNIZED for a whitespace-only prompt", () => {
    expect(() => service.classify("   ")).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "INTENT_NOT_RECOGNIZED" }) }),
    );
  });

  it("throws INTENT_NOT_RECOGNIZED for an empty prompt", () => {
    expect(() => service.classify("")).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "INTENT_NOT_RECOGNIZED" }) }),
    );
  });
});
