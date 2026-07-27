import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Domain error codes for the OmniCore module (Phase 5 Steps 1-2). Kept
 * deliberately separate from `AiDomainErrorCode`
 * (`apps/api/src/ai/ai-provider.interface.ts`) — OmniCore is a
 * distinct module from OmniProvider/Model Manager, and every error it
 * can genuinely produce on its own (as opposed to one it lets
 * propagate unchanged from `ModelSelectorService`/`ProviderRegistryService`/
 * an `OmniProvider` adapter) belongs to its own vocabulary.
 *
 * `INTENT_NOT_RECOGNIZED` is a defensive guard, not a reachable path
 * today: `omniCoreExecuteRequestSchema` already rejects an empty or
 * whitespace-only prompt before `FastRulesEngineService.classify()` is
 * ever called, and every non-empty trimmed prompt matches at least the
 * `"simple-generation"` fallback rule. It exists so `FastRulesEngineService`
 * has a real, typed failure mode to fall back to if a future step's
 * rule set is restructured such that a non-empty prompt can genuinely
 * fail to match anything.
 *
 * `AMBIGUOUS_INTENT` (Phase 5 Step 2) is the reachable counterpart:
 * `FastRulesEngineService.classify()` can genuinely return an
 * `"ambiguous"` intent (see that method's doc comment for the scoring
 * rule), and `CapabilityPlanBuilderService.build()` refuses to compile
 * a `CapabilityPlan` for it — an ambiguous request is a request
 * OmniCore should ask about, not guess at. The thrown exception's
 * response body carries the candidate `alternateIntents` (via
 * `details`) so a caller can pose a real clarification question.
 */
export type OmniCoreDomainErrorCode =
  | "INTENT_NOT_RECOGNIZED"
  | "AMBIGUOUS_INTENT"
  | "INVALID_TASK_PLAN"
  | "CIRCULAR_DEPENDENCY"
  | "MISSING_DEPENDENCY"
  | "DUPLICATE_STEP_ID"
  | "UNSUPPORTED_CAPABILITY_MAPPING"
  | "PLANNING_FAILED";

/**
 * The remaining six codes are Phase 5 Step 3's task-planning domain
 * errors, thrown by `PlanValidatorService`/`DependencyGraphService`
 * while `TaskPlannerService` turns a `CapabilityPlan` into a
 * `TaskPlan`. Like `INTENT_NOT_RECOGNIZED`, none of these are
 * reachable through the public `POST /omnicore/execute` request
 * today — a caller can never submit their own plan or steps
 * (`omniCoreExecuteRequestSchema` accepts only `prompt`), and every
 * `TaskPlan` OmniCore itself builds from a real `CapabilityPlan` is
 * well-formed by construction. They are defensive guards a correctly
 * restructured planner must still satisfy — and the real, reachable
 * failure mode `DependencyGraphService`/`PlanValidatorService`'s own
 * unit tests exercise directly against hand-built, deliberately
 * invalid fixtures:
 *   - `INVALID_TASK_PLAN` — the plan overall is malformed: no steps,
 *     or a step whose `capabilities` is empty.
 *   - `CIRCULAR_DEPENDENCY` — a step's `dependsOn` chain cycles back
 *     to itself.
 *   - `MISSING_DEPENDENCY` — a step's `dependsOn` references a
 *     `stepId` that doesn't exist in the plan.
 *   - `DUPLICATE_STEP_ID` — two steps share the same `stepId`.
 *   - `UNSUPPORTED_CAPABILITY_MAPPING` — a step requires a
 *     `ModelCapability` `CapabilityPlanBuilderService`'s intent map
 *     never produces, i.e. one that could not have been derived from
 *     a real `CapabilityPlan`.
 *   - `PLANNING_FAILED` — a catch-all for a planning failure that
 *     doesn't fit any of the above, kept distinct from
 *     `INTENT_NOT_RECOGNIZED` so a caller can tell "OmniCore couldn't
 *     even classify this" apart from "OmniCore classified this but
 *     failed to plan its execution."
 */

/**
 * Centralizes the HTTP status for each domain code, same convention as
 * `AI_DOMAIN_ERROR_STATUS` in `ai-provider.interface.ts` — so it can
 * never drift between call sites. Every code is `422 Unprocessable
 * Entity`: in every case the request itself was well-formed (it
 * already passed schema validation) but OmniCore cannot act on it as
 * given — because nothing matched, because too much did, or because
 * the plan it tried to build internally failed one of its own
 * invariants.
 */
const OMNICORE_DOMAIN_ERROR_STATUS: Readonly<Record<OmniCoreDomainErrorCode, HttpStatus>> = {
  INTENT_NOT_RECOGNIZED: HttpStatus.UNPROCESSABLE_ENTITY,
  AMBIGUOUS_INTENT: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_TASK_PLAN: HttpStatus.UNPROCESSABLE_ENTITY,
  CIRCULAR_DEPENDENCY: HttpStatus.UNPROCESSABLE_ENTITY,
  MISSING_DEPENDENCY: HttpStatus.UNPROCESSABLE_ENTITY,
  DUPLICATE_STEP_ID: HttpStatus.UNPROCESSABLE_ENTITY,
  UNSUPPORTED_CAPABILITY_MAPPING: HttpStatus.UNPROCESSABLE_ENTITY,
  PLANNING_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
};

/**
 * Builds the normalized `HttpException` for an OmniCore domain error.
 * `details`, added in Phase 5 Step 2, is optional and merged
 * shallowly into the response body alongside `code`/`message` — every
 * existing two-argument call site (Step 1's `INTENT_NOT_RECOGNIZED`
 * throws) is unaffected. Used today to carry `AMBIGUOUS_INTENT`'s
 * `alternateIntents` without adding a second, error-specific
 * constructor function.
 */
export function omniCoreDomainError(
  code: OmniCoreDomainErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): HttpException {
  return new HttpException({ code, message, ...details }, OMNICORE_DOMAIN_ERROR_STATUS[code]);
}
