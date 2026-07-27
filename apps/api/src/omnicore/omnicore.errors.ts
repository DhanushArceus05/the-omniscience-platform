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
export type OmniCoreDomainErrorCode = "INTENT_NOT_RECOGNIZED" | "AMBIGUOUS_INTENT";

/**
 * Centralizes the HTTP status for each domain code, same convention as
 * `AI_DOMAIN_ERROR_STATUS` in `ai-provider.interface.ts` — so it can
 * never drift between call sites. Both codes are `422 Unprocessable
 * Entity`: in both cases the request was well-formed (it already
 * passed schema validation) but OmniCore cannot act on it as given —
 * either because nothing matched, or because too much did.
 */
const OMNICORE_DOMAIN_ERROR_STATUS: Readonly<Record<OmniCoreDomainErrorCode, HttpStatus>> = {
  INTENT_NOT_RECOGNIZED: HttpStatus.UNPROCESSABLE_ENTITY,
  AMBIGUOUS_INTENT: HttpStatus.UNPROCESSABLE_ENTITY,
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
