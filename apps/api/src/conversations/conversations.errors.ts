import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Domain error codes for the Conversations module.
 *
 * `CONVERSATION_NOT_FOUND` (Phase 6 Step 1) is thrown identically
 * whether a conversation id doesn't exist at all, belongs to a
 * different owner, or belongs to a different workspace than the one
 * named in the URL — the same no-enumeration convention
 * `WorkspacesService.getById()` already established for
 * `WORKSPACE_NOT_FOUND`. Phase 6 Step 4 (Conversation Management)
 * reuses this exact code for rename/delete — no new "not found" code
 * is introduced, since the same no-enumeration reasoning applies
 * identically to those two new operations.
 *
 * `MESSAGE_NOT_FOUND` (Phase 6 Step 5 — Message-Level UX) is the same
 * no-enumeration idea applied to a message: thrown identically whether
 * a message id doesn't exist, belongs to a different owner/workspace,
 * or belongs to a different conversation than the one named in the
 * URL. `MESSAGE_NOT_LAST` (Phase 6 Step 5) is deliberately a separate,
 * distinct code rather than folded into `MESSAGE_NOT_FOUND`: it means
 * the message genuinely exists and is the caller's, but isn't (or is
 * no longer) the conversation's current last message — a real state
 * conflict a client can react to specifically (e.g. by refreshing the
 * thread), not an ownership/existence question at all.
 *
 * Every other failure mode a caller of these endpoints can hit is
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
 */
export type ConversationsDomainErrorCode = "CONVERSATION_NOT_FOUND" | "MESSAGE_NOT_FOUND" | "MESSAGE_NOT_LAST";

const CONVERSATIONS_DOMAIN_ERROR_STATUS: Readonly<Record<ConversationsDomainErrorCode, HttpStatus>> =
  {
    CONVERSATION_NOT_FOUND: HttpStatus.NOT_FOUND,
    MESSAGE_NOT_FOUND: HttpStatus.NOT_FOUND,
    MESSAGE_NOT_LAST: HttpStatus.CONFLICT,
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
