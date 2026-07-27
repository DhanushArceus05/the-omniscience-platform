import type { FastRuleMatch, ResolvedOmniCoreIntent } from "@omniscience/types";
import { CapabilityPlanBuilderService } from "./capability-plan-builder.service";

describe("CapabilityPlanBuilderService", () => {
  let service: CapabilityPlanBuilderService;

  function matchFor(intent: ResolvedOmniCoreIntent, ruleId = `fast-rule.${intent}`): FastRuleMatch {
    return { ruleId, intent, confidence: 0.75 };
  }

  beforeEach(() => {
    service = new CapabilityPlanBuilderService();
  });

  describe.each<ResolvedOmniCoreIntent>([
    "simple-generation",
    "question-answering",
    "code-generation",
    "summarization",
    "creative-writing",
  ])("for the %s intent", (intent) => {
    it("builds a single-step plan requiring the text-generation capability", () => {
      const plan = service.build("Do the thing", matchFor(intent));

      expect(plan.intent).toBe(intent);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]).toEqual(
        expect.objectContaining({ capability: "text-generation", input: "Do the thing" }),
      );
    });
  });

  it("passes the prompt through to the step's input verbatim, without trimming or altering it", () => {
    const plan = service.build("  Write a haiku about the ocean  ", matchFor("creative-writing"));
    expect(plan.steps[0]?.input).toBe("  Write a haiku about the ocean  ");
  });

  it("assigns a non-empty, unique planId and stepId", () => {
    const plan = service.build("hello", matchFor("simple-generation"));
    expect(plan.planId).toEqual(expect.any(String));
    expect(plan.planId.length).toBeGreaterThan(0);
    expect(plan.steps[0]?.stepId).toEqual(expect.any(String));
    expect(plan.steps[0]?.stepId.length).toBeGreaterThan(0);
    expect(plan.planId).not.toBe(plan.steps[0]?.stepId);
  });

  it("generates a fresh planId and stepId on every call", () => {
    const first = service.build("hello", matchFor("simple-generation"));
    const second = service.build("hello", matchFor("simple-generation"));

    expect(first.planId).not.toBe(second.planId);
    expect(first.steps[0]?.stepId).not.toBe(second.steps[0]?.stepId);
  });

  describe("ambiguous intent", () => {
    it("throws AMBIGUOUS_INTENT rather than guessing a plan", () => {
      const match: FastRuleMatch = {
        ruleId: "fast-rule.ambiguous",
        intent: "ambiguous",
        confidence: 0.55,
        alternateIntents: ["code-generation", "summarization"],
      };

      expect(() => service.build("Summarize this code snippet", match)).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: "AMBIGUOUS_INTENT" }) }),
      );
    });

    it("forwards the match's alternateIntents in the thrown error's details", () => {
      const match: FastRuleMatch = {
        ruleId: "fast-rule.ambiguous",
        intent: "ambiguous",
        confidence: 0.55,
        alternateIntents: ["code-generation", "summarization"],
      };

      expect(() => service.build("Summarize this code snippet", match)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ alternateIntents: ["code-generation", "summarization"] }),
        }),
      );
    });

    it("forwards an empty alternateIntents array when the match omits it", () => {
      const match: FastRuleMatch = { ruleId: "fast-rule.ambiguous", intent: "ambiguous", confidence: 0.55 };

      expect(() => service.build("hello", match)).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ alternateIntents: [] }) }),
      );
    });
  });
});
