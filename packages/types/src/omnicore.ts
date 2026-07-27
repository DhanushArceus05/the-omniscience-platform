/**
 * OmniCore foundation (Phase 5 Step 1).
 *
 * OmniCore is the platform's orchestration brain — per
 * `docs/04_System_Architecture.md`'s flow (`User → Assistant → OmniCore
 * → capability plan → OmniProvider/Model Manager → specialized modules
 * → validator/reviewer → response composer`) and
 * `docs/06_AI_Architecture.md` ("OmniCore: routing, planning,
 * orchestration, validation and fallback"). This file defines the
 * Step 1 slice of that contract only:
 *
 *   - `FastRuleMatch` — the result of `FastRulesEngineService`'s
 *     deterministic, non-ML intent classification.
 *   - `CapabilityPlan` / `CapabilityPlanStep` — the capability plan a
 *     matched intent is compiled into, expressed purely in terms of
 *     `ModelCapability` (never a vendor name), per the Provider Rule.
 *   - `OmniCoreExecuteRequest` / `OmniCoreExecuteResponse` — the
 *     public contract for `POST /omnicore/execute`.
 *
 * Step 1 recognizes exactly one intent (`"simple-generation"`) and
 * every capability plan it builds has exactly one step. Multi-intent
 * classification ("intent intelligence") is Phase 5 Step 2;
 * multi-step plans for complex tasks ("complex-task planner / pipeline
 * builder") are Phase 5 Step 3. `OmniCoreIntent` and `CapabilityPlan`
 * are deliberately shaped so those steps can extend them additively —
 * `OmniCoreIntent` as a growing union, `CapabilityPlan.steps` as an
 * already-plural array — without a breaking change to this file's
 * exports.
 */

import type { ModelId, ModelCapability, ProviderId } from "./ai-provider";

/**
 * The intent taxonomy OmniCore classifies a request into. Step 1
 * recognizes only `"simple-generation"` — a single-turn, single-step
 * text-generation request. Later steps extend this union (e.g. with a
 * `"complex-task"` intent for the Step 3 planner) rather than
 * replacing it.
 */
export type OmniCoreIntent = "simple-generation";

/**
 * The result of `FastRulesEngineService.classify()`: which rule fired,
 * which intent it maps to, and a deterministic confidence score in
 * `[0, 1]`. "Fast rules" are hand-authored heuristics, not a model
 * call — the score reflects how much the rule's own condition can
 * really tell you about the request, not a probability estimated by
 * inference.
 */
export interface FastRuleMatch {
  readonly ruleId: string;
  readonly intent: OmniCoreIntent;
  readonly confidence: number;
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
 * capability steps to execute. Step 1's `CapabilityPlanBuilderService`
 * only ever produces a single-step plan for the single intent it
 * recognizes; the array shape is already the one a future multi-step
 * planner (Phase 5 Step 3) will populate without changing this type.
 */
export interface CapabilityPlan {
  readonly planId: string;
  readonly intent: OmniCoreIntent;
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
 * matched fast-rule id.
 */
export interface OmniCoreExecuteResponse {
  readonly planId: string;
  readonly intent: OmniCoreIntent;
  readonly matchedRuleId: string;
  readonly confidence: number;
  readonly text: string;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}
