import { describe, expect, it } from "vitest";
import type {
  CapabilityPlan,
  FastRuleMatch,
  OmniCoreExecuteResponse,
  OmniCoreIntent,
  ResolvedOmniCoreIntent,
} from "./omnicore";

describe("omnicore type shapes", () => {
  it("builds a valid FastRuleMatch value for each concrete intent", () => {
    const intents: readonly ResolvedOmniCoreIntent[] = [
      "simple-generation",
      "question-answering",
      "code-generation",
      "summarization",
      "creative-writing",
    ];

    for (const intent of intents) {
      const match: FastRuleMatch = {
        ruleId: `fast-rule.${intent}`,
        intent,
        confidence: 0.75,
      };
      expect(match.intent).toBe(intent);
    }
  });

  it("builds a valid ambiguous FastRuleMatch value, with alternateIntents populated", () => {
    const match: FastRuleMatch = {
      ruleId: "fast-rule.ambiguous",
      intent: "ambiguous",
      confidence: 0.55,
      alternateIntents: ["code-generation", "summarization"],
    };
    expect(match.intent).toBe("ambiguous");
    expect(match.alternateIntents).toEqual(["code-generation", "summarization"]);
  });

  it("allows a non-ambiguous FastRuleMatch to omit alternateIntents entirely", () => {
    const match: FastRuleMatch = {
      ruleId: "fast-rule.default-text-generation",
      intent: "simple-generation",
      confidence: 0.5,
    };
    expect(match.alternateIntents).toBeUndefined();
  });

  it("builds a valid single-step CapabilityPlan value using a ResolvedOmniCoreIntent", () => {
    const plan: CapabilityPlan = {
      planId: "11111111-1111-1111-1111-111111111111",
      intent: "code-generation",
      steps: [
        {
          stepId: "22222222-2222-2222-2222-222222222222",
          capability: "text-generation",
          input: "Write a function that reverses a string",
        },
      ],
    };
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.capability).toBe("text-generation");
  });

  it("builds a valid OmniCoreExecuteResponse value for a non-simple-generation intent", () => {
    const response: OmniCoreExecuteResponse = {
      planId: "11111111-1111-1111-1111-111111111111",
      intent: "summarization",
      matchedRuleId: "fast-rule.summarization",
      confidence: 0.55,
      text: "Here is the summary.",
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      taskPlan: {
        taskPlanId: "33333333-3333-3333-3333-333333333333",
        sourceCapabilityPlanId: "11111111-1111-1111-1111-111111111111",
        intent: "summarization",
        steps: [
          {
            stepId: "22222222-2222-2222-2222-222222222222",
            title: "Summarize the input",
            description: "Produce a concise summary of the provided text.",
            objective: "Summarize the provided text.",
            capabilities: ["text-generation"],
            inputRequirements: "Here is the summary.",
            expectedOutput: "A concise summary of the input text.",
            dependsOn: [],
            executionMode: "sequential",
            complexity: "low",
            failurePolicy: { mode: "abort" },
          },
        ],
        stages: [
          {
            stageId: "44444444-4444-4444-4444-444444444444",
            mode: "sequential",
            stepIds: ["22222222-2222-2222-2222-222222222222"],
          },
        ],
        complexity: "low",
      },
      execution: {
        taskPlanId: "33333333-3333-3333-3333-333333333333",
        status: "completed",
        stageResults: [
          {
            stageId: "44444444-4444-4444-4444-444444444444",
            status: "completed",
            stepResults: [
              {
                stepId: "22222222-2222-2222-2222-222222222222",
                status: "completed",
                output: "Here is the summary.",
                providerId: "anthropic",
                modelId: "claude-sonnet-5",
                startedAt: "2026-07-27T00:00:00.000Z",
                completedAt: "2026-07-27T00:00:01.000Z",
                durationMs: 1000,
              },
            ],
            startedAt: "2026-07-27T00:00:00.000Z",
            completedAt: "2026-07-27T00:00:01.000Z",
            durationMs: 1000,
          },
        ],
        startedAt: "2026-07-27T00:00:00.000Z",
        completedAt: "2026-07-27T00:00:01.000Z",
        durationMs: 1000,
      },
    };
    expect(response.intent).toBe("summarization");
  });

  it("keeps ResolvedOmniCoreIntent as exactly OmniCoreIntent minus ambiguous", () => {
    // Compile-time check: every ResolvedOmniCoreIntent must be assignable
    // to OmniCoreIntent, and "ambiguous" must NOT be assignable to
    // ResolvedOmniCoreIntent. If either assumption breaks, this file
    // fails to type-check.
    const resolved: ResolvedOmniCoreIntent = "creative-writing";
    const widened: OmniCoreIntent = resolved;
    expect(widened).toBe("creative-writing");

    // @ts-expect-error "ambiguous" is deliberately excluded from ResolvedOmniCoreIntent.
    const invalid: ResolvedOmniCoreIntent = "ambiguous";
    expect(invalid).toBe("ambiguous");
  });
});
