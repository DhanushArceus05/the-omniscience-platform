import { FastRulesEngineService } from "./fast-rules-engine.service";

describe("FastRulesEngineService", () => {
  let service: FastRulesEngineService;

  beforeEach(() => {
    service = new FastRulesEngineService();
  });

  describe("simple-generation (fallback)", () => {
    it("classifies a normal-length, keyword-free prompt as simple-generation", () => {
      const result = service.classify("The quick brown fox jumps over the lazy dog");

      expect(result).toEqual({
        ruleId: "fast-rule.simple-generation",
        intent: "simple-generation",
        confidence: 0.5,
      });
    });

    it("classifies a trivially short prompt as simple-generation, at lower confidence", () => {
      const result = service.classify("hi");

      expect(result).toEqual({
        ruleId: "fast-rule.simple-generation",
        intent: "simple-generation",
        confidence: 0.35,
      });
    });

    it("trims the prompt before classifying it", () => {
      const trivial = service.classify("   hi   ");
      expect(trivial.confidence).toBe(0.35);

      const normal = service.classify("   The quick brown fox jumps over the lazy dog   ");
      expect(normal.confidence).toBe(0.5);
    });

    it("treats a prompt of exactly the trivial-length threshold as trivial", () => {
      expect(service.classify("abc").confidence).toBe(0.35);
    });

    it("treats a prompt one character over the trivial-length threshold as non-trivial", () => {
      expect(service.classify("abcd").confidence).toBe(0.5);
    });
  });

  describe("question-answering", () => {
    it("classifies a keyword-led question at 0.55+ confidence", () => {
      const result = service.classify("What is the capital of France");

      expect(result.ruleId).toBe("fast-rule.question-answering");
      expect(result.intent).toBe("question-answering");
      expect(result.confidence).toBe(0.55);
    });

    it("boosts confidence when the prompt also ends with a question mark", () => {
      const result = service.classify("What is the capital of France?");

      expect(result.ruleId).toBe("fast-rule.question-answering");
      expect(result.confidence).toBeCloseTo(0.65, 5);
    });

    it("classifies a bare trailing question mark with no keyword as question-answering", () => {
      const result = service.classify("Is this correct?");

      expect(result.ruleId).toBe("fast-rule.question-answering");
      expect(result.intent).toBe("question-answering");
    });

    it("does not match a prompt with neither a question-answering keyword nor a trailing question mark", () => {
      const result = service.classify("Tell the team the meeting moved to 3pm");
      expect(result.intent).not.toBe("question-answering");
    });
  });

  describe("code-generation", () => {
    it("classifies a code-generation keyword prompt correctly", () => {
      const result = service.classify("Please write a function that reverses a string");

      expect(result.ruleId).toBe("fast-rule.code-generation");
      expect(result.intent).toBe("code-generation");
      expect(result.confidence).toBe(0.55);
    });

    it("raises confidence with additional distinct keyword hits", () => {
      const result = service.classify("Write a function and add a unit test for it, then debug this");

      expect(result.ruleId).toBe("fast-rule.code-generation");
      expect(result.confidence).toBe(0.85);
    });
  });

  describe("summarization", () => {
    it("classifies a summarization keyword prompt correctly", () => {
      const result = service.classify("Summarize the attached report for me");

      expect(result.ruleId).toBe("fast-rule.summarization");
      expect(result.intent).toBe("summarization");
      expect(result.confidence).toBe(0.55);
    });
  });

  describe("creative-writing", () => {
    it("classifies a creative-writing keyword prompt correctly", () => {
      const result = service.classify("Write a poem about the changing seasons");

      expect(result.ruleId).toBe("fast-rule.creative-writing");
      expect(result.intent).toBe("creative-writing");
      expect(result.confidence).toBe(0.55);
    });
  });

  describe("word-boundary matching", () => {
    it("does not match a keyword phrase that only appears as a prefix of a longer, unrelated word", () => {
      // Without a trailing word boundary, "how do" would match the first
      // six characters of "how dogs sleep" (h-o-w-space-d-o). The \b
      // after "do" correctly rejects that, so this must not classify
      // as question-answering.
      const result = service.classify("I wonder how dogs sleep so much of the day");

      expect(result.intent).not.toBe("question-answering");
      expect(result.intent).toBe("simple-generation");
    });
  });

  describe("ambiguous requests", () => {
    it("classifies a prompt that ties between two single-keyword intents as ambiguous", () => {
      // "summarize" (summarization, 1 hit -> 0.55) and "code snippet"
      // (code-generation, 1 hit -> 0.55) tie exactly: margin 0.
      const result = service.classify("Summarize this code snippet");

      expect(result.ruleId).toBe("fast-rule.ambiguous");
      expect(result.intent).toBe("ambiguous");
      expect(result.confidence).toBe(0.55);
      expect(result.alternateIntents).toBeDefined();
      expect([...(result.alternateIntents ?? [])].sort()).toEqual(["code-generation", "summarization"]);
    });

    it("never includes the synthetic ambiguous intent inside alternateIntents, and lists each competitor once", () => {
      const result = service.classify("Summarize this code snippet");
      const alternates = result.alternateIntents ?? [];

      expect(alternates).not.toContain("ambiguous");
      expect(new Set(alternates).size).toBe(alternates.length);
    });

    it("is not ambiguous when one intent clearly outscores every other", () => {
      const result = service.classify("Write a function that reverses a string, and add a unit test for it");
      expect(result.intent).toBe("code-generation");
      expect(result.alternateIntents).toBeUndefined();
    });
  });

  describe("unreachable defensive guard", () => {
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
});
