import { Injectable } from "@nestjs/common";
import type { FastRuleMatch, OmniCoreIntent } from "@omniscience/types";
import { omniCoreDomainError } from "./omnicore.errors";

/**
 * One deterministic, hand-authored classification rule. `test()` runs
 * against the already-trimmed prompt; `confidence` is a fixed score
 * for that rule, not a per-call estimate — a "fast rule" is a
 * heuristic, not an inference.
 */
interface FastRule {
  readonly ruleId: string;
  readonly intent: OmniCoreIntent;
  readonly confidence: number;
  test(trimmedPrompt: string): boolean;
}

/**
 * Threshold, in characters, below which a non-empty trimmed prompt is
 * treated as too short to carry real intent signal (e.g. "hi", "ok",
 * "?"). Below this, OmniCore still classifies the request as
 * `"simple-generation"` (Step 1 recognizes no other intent) but at a
 * deliberately lower confidence, since a fast rule this simple
 * genuinely knows less about a three-character prompt than a full
 * sentence. A trimmed prompt of length zero does not match this rule
 * — it falls through to `classify()`'s `INTENT_NOT_RECOGNIZED` guard
 * instead (see that method's doc comment for why this is unreachable
 * through the public API today).
 */
const TRIVIAL_PROMPT_MAX_LENGTH = 3;

/**
 * `FastRulesEngineService` — OmniCore's "fast rules" layer (Phase 5
 * Step 1), per `docs/06_AI_Architecture.md` ("OmniCore: routing,
 * planning, orchestration, validation and fallback") and
 * `docs/04_System_Architecture.md`'s architecture note ("Fast rules,
 * intent intelligence, complex-task planner, ...").
 *
 * `classify()` runs every rule, in order, against the trimmed prompt
 * and returns the first match. Step 1 intentionally ships only two
 * rules and one recognized intent (`"simple-generation"`) — this is
 * the foundation the Step 2 "intent intelligence" work extends with a
 * richer taxonomy and more rules, not a redesign of this method's
 * contract. Nothing here calls a model or a provider: classification
 * is pure, synchronous, and has no side effects, which is what makes
 * it "fast".
 */
@Injectable()
export class FastRulesEngineService {
  private readonly rules: readonly FastRule[] = [
    {
      ruleId: "fast-rule.trivial-prompt",
      intent: "simple-generation",
      confidence: 0.35,
      test: (trimmedPrompt) => trimmedPrompt.length > 0 && trimmedPrompt.length <= TRIVIAL_PROMPT_MAX_LENGTH,
    },
    {
      ruleId: "fast-rule.default-text-generation",
      intent: "simple-generation",
      confidence: 0.75,
      test: (trimmedPrompt) => trimmedPrompt.length > 0,
    },
  ];

  /**
   * Classifies `prompt` against every rule in order and returns the
   * first match. Throws `INTENT_NOT_RECOGNIZED` if no rule matches —
   * unreachable in Step 1 for any prompt that already passed
   * `omniCoreExecuteRequestSchema` (see the doc comment on that error
   * code), but a real, typed guard rather than a silent fallback.
   */
  classify(prompt: string): FastRuleMatch {
    const trimmedPrompt = prompt.trim();
    for (const rule of this.rules) {
      if (rule.test(trimmedPrompt)) {
        return { ruleId: rule.ruleId, intent: rule.intent, confidence: rule.confidence };
      }
    }
    throw omniCoreDomainError(
      "INTENT_NOT_RECOGNIZED",
      "No fast rule matched the given prompt.",
    );
  }
}
