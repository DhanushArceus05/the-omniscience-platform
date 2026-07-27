import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Domain error codes for the OmniCore module (Phase 5 Step 1). Kept
 * deliberately separate from `AiDomainErrorCode`
 * (`apps/api/src/ai/ai-provider.interface.ts`) — OmniCore is a
 * distinct module from OmniProvider/Model Manager, and every error it
 * can genuinely produce on its own (as opposed to one it lets
 * propagate unchanged from `ModelSelectorService`/`ProviderRegistryService`/
 * an `OmniProvider` adapter) belongs to its own vocabulary.
 *
 * `INTENT_NOT_RECOGNIZED` is a defensive guard, not a reachable path in
 * Step 1: `omniCoreExecuteRequestSchema` already rejects an empty or
 * whitespace-only prompt before `FastRulesEngineService.classify()` is
 * ever called, and Step 1's only rule set always matches any
 * non-empty, trimmed prompt. It exists now so `FastRulesEngineService`
 * has a real, typed failure mode to fall back to as later steps (Phase
 * 5 Step 2's richer intent taxonomy) add rules that can genuinely fail
 * to match.
 */
export type OmniCoreDomainErrorCode = "INTENT_NOT_RECOGNIZED";

/**
 * Centralizes the HTTP status for each domain code, same convention as
 * `AI_DOMAIN_ERROR_STATUS` in `ai-provider.interface.ts` — so it can
 * never drift between call sites.
 */
const OMNICORE_DOMAIN_ERROR_STATUS: Readonly<Record<OmniCoreDomainErrorCode, HttpStatus>> = {
  INTENT_NOT_RECOGNIZED: HttpStatus.UNPROCESSABLE_ENTITY,
};

export function omniCoreDomainError(code: OmniCoreDomainErrorCode, message: string): HttpException {
  return new HttpException({ code, message }, OMNICORE_DOMAIN_ERROR_STATUS[code]);
}
