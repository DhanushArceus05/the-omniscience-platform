import type { FastRuleMatch } from "@omniscience/types";
import { CapabilityPlanBuilderService } from "./capability-plan-builder.service";

describe("CapabilityPlanBuilderService", () => {
  let service: CapabilityPlanBuilderService;

  const match: FastRuleMatch = {
    ruleId: "fast-rule.default-text-generation",
    intent: "simple-generation",
    confidence: 0.75,
  };

  beforeEach(() => {
    service = new CapabilityPlanBuilderService();
  });

  it("builds a single-step plan carrying the matched intent", () => {
    const plan = service.build("Write a haiku about the ocean", match);

    expect(plan.intent).toBe("simple-generation");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toEqual(
      expect.objectContaining({ capability: "text-generation", input: "Write a haiku about the ocean" }),
    );
  });

  it("passes the prompt through to the step's input verbatim, without trimming or altering it", () => {
    const plan = service.build("  Write a haiku about the ocean  ", match);
    expect(plan.steps[0]?.input).toBe("  Write a haiku about the ocean  ");
  });

  it("assigns a non-empty, unique planId and stepId", () => {
    const plan = service.build("hello", match);
    expect(plan.planId).toEqual(expect.any(String));
    expect(plan.planId.length).toBeGreaterThan(0);
    expect(plan.steps[0]?.stepId).toEqual(expect.any(String));
    expect(plan.steps[0]?.stepId.length).toBeGreaterThan(0);
    expect(plan.planId).not.toBe(plan.steps[0]?.stepId);
  });

  it("generates a fresh planId and stepId on every call", () => {
    const first = service.build("hello", match);
    const second = service.build("hello", match);

    expect(first.planId).not.toBe(second.planId);
    expect(first.steps[0]?.stepId).not.toBe(second.steps[0]?.stepId);
  });

  it("carries whichever intent the match reports, not a hardcoded value", () => {
    const plan = service.build("hello", { ...match, intent: "simple-generation" });
    expect(plan.intent).toBe(match.intent);
  });
});
