/**
 * Request/response contracts for the Phase 6 Step 1 conversation and
 * message endpoints — conversation create/list/get, message
 * send/list — all scoped to a workspace the caller owns. There is no
 * update/delete/rename/auto-title endpoint yet (deliberately out of
 * this step's scope, per the approved Step 1 roadmap): `title` is
 * always `null` in this step's responses.
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

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  /** Only present on `role: "assistant"` messages. */
  omniCore?: MessageOmniCoreMetadata;
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
