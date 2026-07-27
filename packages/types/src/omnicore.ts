/**
 * OmniCore foundation and intent intelligence (Phase 5 Steps 1-2).
 *
 * OmniCore is the platform's orchestration brain — per
 * `docs/04_System_Architecture.md`'s flow (`User → Assistant → OmniCore
 * → capability plan → OmniProvider/Model Manager → specialized modules
 * → validator/reviewer → response composer`) and
 * `docs/06_AI_Architecture.md` ("OmniCore: routing, planning,
 * orchestration, validation and fallback"). This file defines:
 *
 *   - `FastRuleMatch` — the result of `FastRulesEngineService`'s
 *     deterministic, non-ML intent classification.
 *   - `CapabilityPlan` / `CapabilityPlanStep` — the capability plan a
 *     resolved intent is compiled into, expressed purely in terms of
 *     `ModelCapability` (never a vendor name), per the Provider Rule.
 *   - `OmniCoreExecuteRequest` / `OmniCoreExecuteResponse` — the
 *     public contract for `POST /omnicore/execute`.
 *
 * Step 1 recognized exactly one intent (`"simple-generation"`) and
 * every capability plan had exactly one step. Step 2 ("intent
 * intelligence") expands `OmniCoreIntent` to a real taxonomy and adds
 * `"ambiguous"` as an explicit, unplannable intent — see
 * `ResolvedOmniCoreIntent` below for why that distinction is encoded
 * in the type system, not just in a comment. Multi-step plans for
 * complex tasks ("complex-task planner / pipeline builder") remain
 * Phase 5 Step 3; `CapabilityPlan.steps` is already the plural shape
 * that step will populate without a breaking change to this file's
 * exports.
 */

import type { ModelId, ModelCapability, ProviderId } from "./ai-provider";

/**
 * The intent taxonomy OmniCore classifies a request into (Phase 5
 * Step 2). The five "concrete" intents each correspond to a real,
 * distinguishable request shape `FastRulesEngineService` looks for;
 * `"ambiguous"` is not a request shape at all but an explicit
 * classification outcome — "the fast rules couldn't tell which of two
 * or more concrete intents this is, confidently enough to guess." A
 * later step's richer taxonomy or ML-based classifier extends this
 * union further rather than replacing it.
 */
export type OmniCoreIntent =
  | "simple-generation"
  | "question-answering"
  | "code-generation"
  | "summarization"
  | "creative-writing"
  | "ambiguous";

/**
 * The subset of `OmniCoreIntent` that can actually be compiled into an
 * executable `CapabilityPlan` — every intent except `"ambiguous"`.
 * `CapabilityPlanBuilderService.build()` only ever produces a plan for
 * a `ResolvedOmniCoreIntent`; asking it to plan for `"ambiguous"`
 * itself is a domain error (`AMBIGUOUS_INTENT`), not a special case
 * the planner silently guesses through. Both `CapabilityPlan.intent`
 * and `OmniCoreExecuteResponse.intent` use this narrower type
 * specifically so "a plan/response was produced" and "the intent is
 * plannable" can never come apart at the type level.
 */
export type ResolvedOmniCoreIntent = Exclude<OmniCoreIntent, "ambiguous">;

/**
 * The result of `FastRulesEngineService.classify()`: which rule fired
 * (or the synthetic `"fast-rule.ambiguous"` id when none did clearly
 * enough), which intent it maps to, and a deterministic confidence
 * score in `[0, 1]`. "Fast rules" are hand-authored heuristics, not a
 * model call — the score reflects how much the rule's own condition
 * can really tell you about the request, not a probability estimated
 * by inference.
 */
export interface FastRuleMatch {
  readonly ruleId: string;
  readonly intent: OmniCoreIntent;
  readonly confidence: number;
  /**
   * Populated only when `intent` is `"ambiguous"`: the other concrete
   * intents that scored close enough to the winner that picking just
   * one would have been a guess rather than a classification. Always
   * omitted for a non-ambiguous match. Exists so a caller — today,
   * the `AMBIGUOUS_INTENT` domain error's response body; eventually,
   * the Phase 6 Assistant — can surface a real clarification question
   * ("did you mean X or Y?") instead of a bare "I'm not sure."
   */
  readonly alternateIntents?: readonly ResolvedOmniCoreIntent[];
}

/**
 * One unit of work in a `CapabilityPlan`, expressed as a required
 * `ModelCapability` plus the input for that step — never a provider or
 * model id, per the Provider Rule ("business logic requests
 * capabilities, never vendor names"). Which provider/model actually
 * executes a step is decided later, by `ModelSelectorService`.
 */
export interface CapabilityPlanStep {
  readonly stepId: string;
  readonly capability: ModelCapability;
  readonly input: string;
}

/**
 * The compiled output of intent classification: an ordered list of
 * capability steps to execute. Step 1/2's `CapabilityPlanBuilderService`
 * only ever produces a single-step plan for whichever `ResolvedOmniCoreIntent`
 * it's given; the array shape is already the one a future multi-step
 * planner (Phase 5 Step 3) will populate without changing this type.
 */
export interface CapabilityPlan {
  readonly planId: string;
  readonly intent: ResolvedOmniCoreIntent;
  readonly steps: readonly CapabilityPlanStep[];
}

/** `POST /omnicore/execute` request body (validated by `omniCoreExecuteRequestSchema`). */
export interface OmniCoreExecuteRequest {
  readonly prompt: string;
}

/**
 * `POST /omnicore/execute` response body. Deliberately mirrors
 * `GenerateTextResponse`'s `{ text, providerId, modelId }` shape plus
 * the OmniCore-specific routing/confidence metadata
 * (`planId`/`intent`/`matchedRuleId`/`confidence`) — never a raw
 * `CapabilityPlan` or internal selector routing detail beyond the
 * matched fast-rule id. `intent` is a `ResolvedOmniCoreIntent`: a
 * successful response, by construction, can never carry `"ambiguous"`
 * — an ambiguous classification is rejected before a plan (and so
 * before a response) can ever be built. See `AMBIGUOUS_INTENT` in
 * `apps/api/src/omnicore/omnicore.errors.ts` for what a caller gets
 * instead.
 */
export interface OmniCoreExecuteResponse {
  readonly planId: string;
  readonly intent: ResolvedOmniCoreIntent;
  readonly matchedRuleId: string;
  readonly confidence: number;
  readonly text: string;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}
