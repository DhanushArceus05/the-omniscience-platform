import { Injectable } from "@nestjs/common";
import type { FastRuleMatch, ResolvedOmniCoreIntent } from "@omniscience/types";
import { omniCoreDomainError } from "./omnicore.errors";

/**
 * One deterministic, hand-authored classification rule. `score()` runs
 * against the already-trimmed prompt and returns a confidence in
 * `[0, 1]`, or exactly `0` when the rule's condition doesn't match at
 * all. A "fast rule" is a heuristic, not an inference — there is no
 * model call anywhere in this file, which is what makes it "fast".
 */
interface FastRule {
  readonly ruleId: string;
  readonly intent: ResolvedOmniCoreIntent;
  score(trimmedPrompt: string, lowerPrompt: string): number;
}

/**
 * Threshold, in characters, below which a non-empty trimmed prompt is
 * treated as too short to carry real intent signal for the
 * `"simple-generation"` fallback rule (e.g. "hi", "ok"). A trimmed
 * prompt of length zero scores `0` on every rule and falls through to
 * `classify()`'s `INTENT_NOT_RECOGNIZED` guard instead.
 */
const TRIVIAL_PROMPT_MAX_LENGTH = 3;

/**
 * How many hits on a rule's keyword list map to how much confidence.
 * Deliberately capped below 1.0 — a fast rule counting keyword
 * occurrences should never claim full certainty about a natural-
 * language request; that headroom is also what leaves room for the
 * question-answering rule's trailing-`?` boost to still mean something.
 */
function confidenceForKeywordHits(hits: number): number {
  if (hits >= 3) {
    return 0.85;
  }
  if (hits === 2) {
    return 0.7;
  }
  if (hits === 1) {
    return 0.55;
  }
  return 0;
}

/** Counts how many of `phrases` appear in `lowerPrompt`, each matched on a word boundary so "code" doesn't match inside "decode". */
function countPhraseHits(lowerPrompt: string, phrases: readonly string[]): number {
  return phrases.reduce((count, phrase) => (phraseMatches(lowerPrompt, phrase) ? count + 1 : count), 0);
}

function phraseMatches(lowerPrompt: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(lowerPrompt);
}

const QUESTION_ANSWERING_KEYWORDS: readonly string[] = [
  "what is",
  "what are",
  "what does",
  "why is",
  "why does",
  "why are",
  "how do",
  "how does",
  "how can",
  "how many",
  "when did",
  "when is",
  "where is",
  "who is",
  "which is",
  "can you explain",
  "can you tell me",
  "explain why",
  "explain how",
];

const CODE_GENERATION_KEYWORDS: readonly string[] = [
  "write a function",
  "write code",
  "generate code",
  "implement a function",
  "implement an algorithm",
  "fix this bug",
  "debug this",
  "refactor this",
  "write a python",
  "write a typescript",
  "write a javascript",
  "write a sql query",
  "regular expression",
  "regex for",
  "code snippet",
  "unit test for",
];

const SUMMARIZATION_KEYWORDS: readonly string[] = [
  "summarize",
  "summarise",
  "summary of",
  "tl;dr",
  "tldr",
  "condense this",
  "shorten this",
  "key points",
  "in a few sentences",
  "give me a summary",
  "short summary",
];

const CREATIVE_WRITING_KEYWORDS: readonly string[] = [
  "write a poem",
  "write a haiku",
  "write a story",
  "write a short story",
  "write a sonnet",
  "write lyrics",
  "creative writing",
  "fictional story",
  "write a novel",
  "bedtime story",
];

/**
 * Two rule scores are treated as "too close to call" when they're
 * within this margin of each other. `0.15` is wide enough to separate
 * a single-keyword match (0.55) from a two-keyword match (0.7), but
 * narrow enough that two genuinely competing single-keyword matches
 * (both 0.55, margin 0) are still caught as ambiguous. The generic
 * `"simple-generation"` fallback rule is deliberately never a
 * candidate in this comparison at all (see `classify()`) — a specific
 * keyword match scoring only marginally above the 0.5 fallback
 * baseline is not "ambiguous with the fallback," it's just a weak but
 * real signal; only two *specific* intents genuinely competing with
 * each other should ever produce `"ambiguous"`.
 */
const AMBIGUITY_MARGIN = 0.15;

/**
 * `FastRulesEngineService` — OmniCore's "fast rules" / intent
 * intelligence layer (Phase 5 Steps 1-2), per
 * `docs/06_AI_Architecture.md` ("OmniCore: routing, planning,
 * orchestration, validation and fallback") and
 * `docs/04_System_Architecture.md`'s architecture note ("Fast rules,
 * intent intelligence, complex-task planner, ...").
 *
 * `classify()` scores every rule against the trimmed prompt (not just
 * "first match wins", as in Step 1) and picks the highest-confidence
 * result. If two or more *specific* intents (i.e. excluding the
 * generic `"simple-generation"` fallback) scored within
 * `AMBIGUITY_MARGIN` of each other, the classification is genuinely
 * uncertain between them — `classify()` returns the synthetic
 * `"ambiguous"` intent instead of guessing, with every tied intent
 * listed in `alternateIntents`. Nothing here calls a model or a
 * provider: classification is pure, synchronous, and has no side
 * effects.
 *
 * Step 2 ships five concrete intents (question-answering,
 * code-generation, summarization, creative-writing, and the
 * simple-generation fallback) each backed by one keyword-scored rule.
 * This is the seam a richer taxonomy or an ML-based classifier
 * extends later — `classify()`'s scoring/ambiguity-detection algorithm
 * is written against the general `FastRule` shape, not against these
 * five rules specifically, so adding a sixth rule requires no change
 * to this method.
 */
@Injectable()
export class FastRulesEngineService {
  private readonly rules: readonly FastRule[] = [
    {
      ruleId: "fast-rule.question-answering",
      intent: "question-answering",
      score: (trimmedPrompt, lowerPrompt) => {
        const hits = countPhraseHits(lowerPrompt, QUESTION_ANSWERING_KEYWORDS);
        const endsWithQuestionMark = trimmedPrompt.endsWith("?");
        if (hits === 0 && !endsWithQuestionMark) {
          return 0;
        }
        const base = hits > 0 ? confidenceForKeywordHits(hits) : 0.55;
        return endsWithQuestionMark ? Math.min(base + 0.1, 0.85) : base;
      },
    },
    {
      ruleId: "fast-rule.code-generation",
      intent: "code-generation",
      score: (_trimmedPrompt, lowerPrompt) => confidenceForKeywordHits(countPhraseHits(lowerPrompt, CODE_GENERATION_KEYWORDS)),
    },
    {
      ruleId: "fast-rule.summarization",
      intent: "summarization",
      score: (_trimmedPrompt, lowerPrompt) => confidenceForKeywordHits(countPhraseHits(lowerPrompt, SUMMARIZATION_KEYWORDS)),
    },
    {
      ruleId: "fast-rule.creative-writing",
      intent: "creative-writing",
      score: (_trimmedPrompt, lowerPrompt) => confidenceForKeywordHits(countPhraseHits(lowerPrompt, CREATIVE_WRITING_KEYWORDS)),
    },
    {
      ruleId: "fast-rule.simple-generation",
      intent: "simple-generation",
      score: (trimmedPrompt) => {
        if (trimmedPrompt.length === 0) {
          return 0;
        }
        return trimmedPrompt.length <= TRIVIAL_PROMPT_MAX_LENGTH ? 0.35 : 0.5;
      },
    },
  ];

  /**
   * Classifies `prompt` by scoring every rule and returning the
   * highest-confidence match, or `"ambiguous"` (with `alternateIntents`
   * listing every intent in the tie, including whichever one happened
   * to sort first) when two or more *specific* intents — i.e.
   * excluding the generic `"simple-generation"` fallback, see
   * `AMBIGUITY_MARGIN`'s doc comment — scored within `AMBIGUITY_MARGIN`
   * of each other. Throws `INTENT_NOT_RECOGNIZED` if literally nothing
   * scored above `0` — unreachable for any prompt that already passed
   * `omniCoreExecuteRequestSchema` (see that error code's doc comment),
   * but a real, typed guard rather than a silent fallback.
   */
  classify(prompt: string): FastRuleMatch {
    const trimmedPrompt = prompt.trim();
    const lowerPrompt = trimmedPrompt.toLowerCase();

    const scored = this.rules
      .map((rule) => ({ rule, confidence: rule.score(trimmedPrompt, lowerPrompt) }))
      .filter((candidate) => candidate.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);

    const winner = scored[0];
    if (!winner) {
      throw omniCoreDomainError("INTENT_NOT_RECOGNIZED", "No fast rule matched the given prompt.");
    }

    // The fallback never competes for ambiguity: a specific keyword
    // match scoring only marginally above the generic baseline is a
    // weak-but-real signal, not a tie against "no signal at all".
    const tiedSpecificIntents = scored.filter(
      (candidate) =>
        candidate.rule.intent !== "simple-generation" && winner.confidence - candidate.confidence < AMBIGUITY_MARGIN,
    );

    if (tiedSpecificIntents.length > 1) {
      const alternateIntents = dedupeIntents(tiedSpecificIntents.map((candidate) => candidate.rule.intent));
      return {
        ruleId: "fast-rule.ambiguous",
        intent: "ambiguous",
        confidence: winner.confidence,
        alternateIntents,
      };
    }

    return { ruleId: winner.rule.ruleId, intent: winner.rule.intent, confidence: winner.confidence };
  }
}

function dedupeIntents(intents: readonly ResolvedOmniCoreIntent[]): readonly ResolvedOmniCoreIntent[] {
  return Array.from(new Set(intents));
}
