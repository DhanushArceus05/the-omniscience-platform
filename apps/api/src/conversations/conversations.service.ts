import { Injectable } from "@nestjs/common";
import {
  DEFAULT_CONVERSATION_LIST_LIMIT,
  DEFAULT_MESSAGE_LIST_LIMIT,
} from "@omniscience/schemas";
import type {
  Conversation,
  CreateConversationResponse,
  GetConversationResponse,
  ListConversationsResponse,
  ListMessagesResponse,
  Message,
  MessageOmniCoreMetadata,
  SendMessageResponse,
} from "@omniscience/types";
import { OmniCoreService } from "../omnicore/omnicore.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { conversationsDomainError } from "./conversations.errors";
import { ConversationsRepository } from "./conversations.repository";

/**
 * Orchestrates the Phase 6 Step 1 conversation/message foundation:
 * create/list/get a conversation, and send/list messages — routing
 * every message through the existing `OmniCoreService.execute()`
 * pipeline exactly as `OmniCoreController.execute()` already does.
 *
 * Every operation is scoped exclusively to the caller's own
 * workspace-owned conversations — `ownerId` always comes from the
 * verified JWT payload the controller passes in, never from request
 * input, same convention `WorkspacesService` already established. No
 * Mongo access happens here directly — only through
 * `ConversationsRepository`.
 *
 * `createConversation`/`listConversations` check workspace ownership
 * via `WorkspacesService`. `getConversation`/`listMessages`/
 * `sendMessage` do not — see `getConversation()`'s doc comment for why
 * a separate workspace-ownership pre-check on a conversation-scoped
 * operation would leak which part of the ownership chain failed.
 *
 * There is no update/delete/rename/auto-title here — explicitly out
 * of Step 1's approved scope (see `claude/CURRENT_PHASE.md`'s Phase 6
 * Step 1 section for the full list of what's deferred).
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly repository: ConversationsRepository,
    private readonly workspaces: WorkspacesService,
    private readonly omniCore: OmniCoreService,
  ) {}

  /** Verifies the caller owns `workspaceId` (via `WorkspacesService`, throwing its own `WORKSPACE_NOT_FOUND` if not) before creating a conversation in it. `createConversation`/`listConversations` are the only operations in this service that address a workspace as the primary resource with no `conversationId` to hide behind, so `WORKSPACE_NOT_FOUND` here reveals nothing a caller doesn't already know from `GET /workspaces`. */
  async createConversation(ownerId: string, workspaceId: string): Promise<CreateConversationResponse> {
    await this.workspaces.getById(ownerId, workspaceId);
    return this.repository.createConversation(ownerId, workspaceId);
  }

  async listConversations(
    ownerId: string,
    workspaceId: string,
    params: { limit?: number; cursor?: string },
  ): Promise<ListConversationsResponse> {
    await this.workspaces.getById(ownerId, workspaceId);
    return this.repository.listConversations(ownerId, workspaceId, {
      limit: params.limit ?? DEFAULT_CONVERSATION_LIST_LIMIT,
      cursor: params.cursor,
    });
  }

  /**
   * `getConversation`/`listMessages`/`sendMessage` all address a
   * specific `conversationId` as the primary resource. They
   * deliberately do **not** call `WorkspacesService.getById()` first:
   * doing so would let a caller who doesn't own `workspaceId` at all
   * be told `WORKSPACE_NOT_FOUND`, while a caller who owns
   * `workspaceId` but not `conversationId` is told
   * `CONVERSATION_NOT_FOUND` — two different codes for "not yours,"
   * which lets a caller distinguish "I don't own this workspace" from
   * "I own this workspace but not this conversation" purely from the
   * error code, an ownership signal this endpoint has no reason to
   * expose. `getOwnedConversationOrThrow()` below already scopes its
   * repository lookup by `ownerId` **and** `workspaceId` **and**
   * `conversationId` together — a caller who doesn't own the workspace,
   * doesn't own the conversation, or names a conversation that isn't
   * actually in that workspace all produce the same `null`, and
   * therefore the same `CONVERSATION_NOT_FOUND` — one uniform "not
   * found for you" answer regardless of which part of the ownership
   * chain didn't match. Authorization is fully preserved: a caller can
   * still never read, list, or send into a conversation they don't own.
   */
  async getConversation(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<GetConversationResponse> {
    return this.getOwnedConversationOrThrow(ownerId, workspaceId, conversationId);
  }

  async listMessages(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    params: { limit?: number; cursor?: string },
  ): Promise<ListMessagesResponse> {
    await this.getOwnedConversationOrThrow(ownerId, workspaceId, conversationId);
    return this.repository.listMessages(ownerId, workspaceId, conversationId, {
      limit: params.limit ?? DEFAULT_MESSAGE_LIST_LIMIT,
      cursor: params.cursor,
    });
  }

  /**
   * Persists the user message, calls `OmniCoreService.execute()`, and
   * persists the assistant reply — in that order, per the approved
   * Step 1 decision. If OmniCore execution fails, the already-persisted
   * user message is **not** rolled back and no assistant message (real,
   * fake, or empty) is ever persisted: the thrown OmniCore domain
   * error propagates to the caller unchanged, exactly as it already
   * does through `POST /omnicore/execute`. See `getConversation()`'s
   * doc comment above for why this method resolves ownership via
   * `getOwnedConversationOrThrow()` alone, with no separate
   * `WorkspacesService.getById()` pre-check.
   */
  async sendMessage(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    content: string,
  ): Promise<SendMessageResponse> {
    await this.getOwnedConversationOrThrow(ownerId, workspaceId, conversationId);

    const userMessage: Message = await this.repository.createMessage({
      conversationId,
      workspaceId,
      ownerId,
      role: "user",
      content,
    });

    // Deliberately not wrapped in try/catch: an OmniCore domain error
    // must propagate to the caller unchanged (see this method's doc
    // comment) — `userMessage` above is already persisted and stays
    // that way regardless of what happens next.
    const result = await this.omniCore.execute(content);

    const omniCoreMetadata: MessageOmniCoreMetadata = {
      planId: result.planId,
      intent: result.intent,
      matchedRuleId: result.matchedRuleId,
      confidence: result.confidence,
      providerId: result.providerId,
      modelId: result.modelId,
      taskPlanId: result.execution.taskPlanId,
    };

    const assistantMessage: Message = await this.repository.createMessage({
      conversationId,
      workspaceId,
      ownerId,
      role: "assistant",
      content: result.text,
      omniCore: omniCoreMetadata,
    });

    await this.repository.touchConversation(conversationId, preview(result.text));

    return { userMessage, assistantMessage };
  }

  /** Shared "own conversation or 404" lookup — `null` from the repository becomes the shared `CONVERSATION_NOT_FOUND`. */
  private async getOwnedConversationOrThrow(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Conversation> {
    const conversation = await this.repository.getConversation(ownerId, workspaceId, conversationId);
    if (!conversation) {
      throw conversationsDomainError("CONVERSATION_NOT_FOUND", "Conversation not found.");
    }
    return conversation;
  }
}

/** Trims a message's text down to a short preview for a future conversation-list UI — not exposed by any Step 1 endpoint today, but cheap to keep current. */
function preview(text: string, maxLength = 140): string {
  const trimmed = text.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}
