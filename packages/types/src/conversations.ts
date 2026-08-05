/**
 * Request/response contracts for the conversation and message
 * endpoints — conversation create/list/get/rename/delete (rename and
 * delete added in Phase 6 Step 4 — Conversation Management), message
 * send/list. There is still no auto-title-generation endpoint
 * (deliberately out of scope — see `claude/CURRENT_PHASE.md`'s Phase 6
 * Step 4 section): `title` remains `null` until a caller explicitly
 * renames a conversation.
 *
 * Mirrors `workspaces.ts`'s exact shape: a plain resource type, a
 * `Create*Response`/`Get*Response` alias where the response is just
 * the resource, and a bounded/cursor-paginated `List*Response` for the
 * list endpoints.
 */

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateConversationResponse = Conversation;

export interface ListConversationsQuery {
  /** Defaults server-side; capped server-side — see `DEFAULT_CONVERSATION_LIST_LIMIT`/`MAX_CONVERSATION_LIST_LIMIT` in `@omniscience/schemas`. */
  limit?: number;
  /** Opaque cursor from a previous `ListConversationsResponse.nextCursor`. */
  cursor?: string;
}

export interface ListConversationsResponse {
  /** Newest-first (by `createdAt`, tie-broken by `id`). */
  conversations: Conversation[];
  /** `null` when there is no further page. */
  nextCursor: string | null;
}

export type GetConversationResponse = Conversation;

/**
 * `PATCH /workspaces/:workspaceId/conversations/:conversationId` body
 * (Phase 6 Step 4 — Conversation Management).
 */
export interface RenameConversationRequest {
  title: string;
}

export type RenameConversationResponse = Conversation;

/**
 * `DELETE /workspaces/:workspaceId/conversations/:conversationId`
 * response (Phase 6 Step 4). Same `{ <verb>: true }` shape convention
 * `DeleteAccountResponse`/`RevokeSessionResponse` already established
 * — irreversible, and cascades to every message the deleted
 * conversation owned (see `ConversationsRepository.deleteConversation()`).
 */
export interface DeleteConversationResponse {
  deleted: true;
}

/**
 * The trimmed, non-secret slice of `OmniCoreExecuteResponse` persisted
 * onto an assistant `Message` — routing/confidence metadata only,
 * never the full `taskPlan`/`execution` internal-diagnostic objects.
 * Present only on `role: "assistant"` messages.
 */
export interface MessageOmniCoreMetadata {
  planId: string;
  intent: string;
  matchedRuleId: string;
  confidence: number;
  providerId: string;
  modelId: string;
  taskPlanId: string;
}

export type MessageRole = "user" | "assistant";

/**
 * Whether a persisted message's `content` is the full text it was
 * ever going to have (`"complete"`) or was cut short by a client
 * disconnect, an explicit cancellation, or a provider failure partway
 * through a Phase 6 Step 2 streamed response (`"incomplete"`).
 *
 * Every message created before Phase 6 Step 2 has no `status` field
 * on its Mongo document at all — there was only ever one way for a
 * message to be persisted, and it was always the complete text.
 * `ConversationsRepository` normalizes that legacy absence to
 * `"complete"` when mapping a document to this type, so `status` is
 * always present on a `Message` a caller sees, never `undefined` —
 * no destructive migration of existing documents is required.
 */
export type MessageStatus = "complete" | "incomplete";

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  /** Only present on `role: "assistant"` messages. */
  omniCore?: MessageOmniCoreMetadata;
  /**
   * Always `"complete"` for a message created through the
   * non-streaming `POST .../messages` endpoint (Phase 6 Step 1) — it
   * has no partial-text failure mode. A message created through the
   * streaming `POST .../messages/stream` endpoint (Phase 6 Step 2)
   * carries whichever status actually applied when it was persisted.
   */
  status: MessageStatus;
}

export interface ListMessagesQuery {
  /** Defaults server-side; capped server-side — see `DEFAULT_MESSAGE_LIST_LIMIT`/`MAX_MESSAGE_LIST_LIMIT` in `@omniscience/schemas`. */
  limit?: number;
  /** Opaque cursor from a previous `ListMessagesResponse.nextCursor`. */
  cursor?: string;
}

export interface ListMessagesResponse {
  /** Chronological (oldest first, by `createdAt`, tie-broken by `id`) — reading order, not newest-first like conversations. */
  messages: Message[];
  /** `null` when there is no further page. */
  nextCursor: string | null;
}

export interface SendMessageRequest {
  content: string;
}

/**
 * `POST /workspaces/:workspaceId/conversations/:conversationId/messages`
 * response. Always both messages together: the persisted user message
 * and the persisted assistant reply produced by routing `content`
 * through the existing `OmniCoreService.execute()` pipeline. If
 * OmniCore execution fails, this response is never produced — the
 * user message is still persisted (reachable again via `GET
 * .../messages`), but the existing OmniCore domain error propagates
 * to the caller unchanged instead of this shape.
 */
export interface SendMessageResponse {
  userMessage: Message;
  assistantMessage: Message;
}
