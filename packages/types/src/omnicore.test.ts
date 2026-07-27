import { describe, expect, it } from "vitest";
import type { CapabilityPlan, FastRuleMatch, OmniCoreExecuteResponse } from "./omnicore";

describe("omnicore type shapes", () => {
  it("builds a valid FastRuleMatch value", () => {
    const match: FastRuleMatch = {
      ruleId: "fast-rule.default-text-generation",
      intent: "simple-generation",
      confidence: 0.75,
    };
    expect(match.intent).toBe("simple-generation");
  });

  it("builds a valid single-step CapabilityPlan value", () => {
    const plan: CapabilityPlan = {
      planId: "11111111-1111-1111-1111-111111111111",
      intent: "simple-generation",
      steps: [
        {
          stepId: "22222222-2222-2222-2222-222222222222",
          capability: "text-generation",
          input: "Say hello",
        },
      ],
    };
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.capability).toBe("text-generation");
  });

  it("builds a valid OmniCoreExecuteResponse value", () => {
    const response: OmniCoreExecuteResponse = {
      planId: "11111111-1111-1111-1111-111111111111",
      intent: "simple-generation",
      matchedRuleId: "fast-rule.default-text-generation",
      confidence: 0.75,
      text: "Hello!",
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
    };
    expect(response.providerId).toBe("anthropic");
  });
});
