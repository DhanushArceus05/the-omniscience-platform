import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Domain error codes for the Conversations module (Phase 6 Step 1 —
 * Conversation & Message Persistence Foundation).
 *
 * `CONVERSATION_NOT_FOUND` is the only code this module introduces —
 * every other failure mode a caller of these endpoints can hit is
 * already a typed error owned by another module and is left to
 * propagate unchanged:
 *   - `WORKSPACE_NOT_FOUND` (`WorkspacesService`, Phase 3) — the
 *     target workspace doesn't exist or isn't the caller's.
 *   - `VALIDATION_ERROR` (`ZodValidationPipe`, Phase 2) — malformed
 *     request body, query, or route param.
 *   - Every `OmniCoreDomainErrorCode`
 *     (`apps/api/src/omnicore/omnicore.errors.ts`, Phase 5) — a
 *     failure raised by `OmniCoreService.execute()` itself
 *     (`AMBIGUOUS_INTENT`, `TOOL_TIMEOUT`, etc.).
 *
 * `CONVERSATION_NOT_FOUND` is thrown identically whether a
 * conversation id doesn't exist at all, belongs to a different owner,
 * or belongs to a different workspace than the one named in the URL
 * — the same no-enumeration convention `WorkspacesService.getById()`
 * already established for `WORKSPACE_NOT_FOUND`.
 */
export type ConversationsDomainErrorCode = "CONVERSATION_NOT_FOUND";

const CONVERSATIONS_DOMAIN_ERROR_STATUS: Readonly<Record<ConversationsDomainErrorCode, HttpStatus>> =
  {
    CONVERSATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  };

/**
 * Builds the normalized `HttpException` for a Conversations domain
 * error — same `{ code, message, ...HttpStatus }` shape
 * `omniCoreDomainError()` already established, kept as its own small
 * function (rather than importing that one) so this module's error
 * vocabulary stays self-contained, exactly as `OmniCoreDomainErrorCode`
 * itself stays a separate vocabulary from `AiDomainErrorCode`.
 */
export function conversationsDomainError(
  code: ConversationsDomainErrorCode,
  message: string,
): HttpException {
  return new HttpException({ code, message }, CONVERSATIONS_DOMAIN_ERROR_STATUS[code]);
}
