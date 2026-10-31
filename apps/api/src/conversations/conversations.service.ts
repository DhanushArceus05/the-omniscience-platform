import { HttpException, Injectable } from "@nestjs/common";
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
  MessageStreamEvent,
  SendMessageResponse,
  Citation,
  KnowledgeMessageAttribution,
} from "@omniscience/types";
import { OmniCoreService } from "../omnicore/omnicore.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { conversationsDomainError } from "./conversations.errors";
import { ConversationsRepository, type UserMessageRequestClaim } from "./conversations.repository";
import { KnowledgeRetrievalService, type RetrievedKnowledgeSource } from "../knowledge/knowledge-retrieval.service";
import { KnowledgeContextService } from "../knowledge/knowledge-context.service";
import type { KnowledgeReadLease } from "../knowledge/knowledge-read-lease.service";

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
 * There is no auto-title generation here — still explicitly out of
 * scope (see `claude/CURRENT_PHASE.md`'s Phase 6 Step 1 section for
 * the full list of what was originally deferred). Manual rename and
 * delete were added in Phase 6 Step 4 — see `renameConversation()`/
 * `deleteConversation()` below.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly repository: ConversationsRepository,
    private readonly workspaces: WorkspacesService,
    private readonly omniCore: OmniCoreService,
    private readonly knowledgeRetrieval: KnowledgeRetrievalService,
    private readonly knowledgeContext: KnowledgeContextService,
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

  /**
   * Renames the caller's own conversation (Phase 6 Step 4). Same
   * ownership resolution as every other conversation-scoped method
   * here — `getOwnedConversationOrThrow()` first, so a caller renaming
   * a conversation they don't own gets the identical
   * `CONVERSATION_NOT_FOUND` as one that doesn't exist at all. The
   * repository call is expected to succeed once ownership has already
   * been proven; its `null` case is a defensive fallback (e.g. a
   * concurrent delete landing between the two calls), surfaced as the
   * same shared error rather than a distinct code, since from the
   * caller's perspective the outcome is identical either way — the
   * conversation isn't there for them anymore.
   */
  async renameConversation(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    title: string,
  ): Promise<Conversation> {
    await this.getOwnedConversationOrThrow(ownerId, workspaceId, conversationId);
    const renamed = await this.repository.renameConversation(ownerId, workspaceId, conversationId, title);
    if (!renamed) {
      throw conversationsDomainError("CONVERSATION_NOT_FOUND", "Conversation not found.");
    }
    return renamed;
  }

  /**
   * Deletes the caller's own conversation, cascading to every message
   * scoped to it (Phase 6 Step 4). Same ownership resolution as
   * `renameConversation()` above. The repository's own `deleteOne`
   * filter (`_id`+`ownerId`+`workspaceId`) is a second, independent
   * ownership check beyond `getOwnedConversationOrThrow()` — the same
   * defense-in-depth every write in this repository already applies —
   * so this method never depends on the earlier check alone.
   */
  async deleteConversation(ownerId: string, workspaceId: string, conversationId: string): Promise<void> {
    await this.getOwnedConversationOrThrow(ownerId, workspaceId, conversationId);
    const deleted = await this.repository.deleteConversation(ownerId, workspaceId, conversationId);
    if (!deleted) {
      throw conversationsDomainError("CONVERSATION_NOT_FOUND", "Conversation not found.");
    }
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
   * Deletes `messageId`, but only when it's genuinely the
   * conversation's current last message (Phase 6 Step 5 — Message-
   * Level UX). Same ownership resolution as every other conversation-
   * scoped method here — `getOwnedConversationOrThrow()` first, so a
   * caller acting on a conversation they don't own gets the identical
   * `CONVERSATION_NOT_FOUND` as one that doesn't exist. This is the
   * one guarded primitive the frontend's regenerate and edit-and-resend
   * flows are both built on: it never accepts a "this is the last
   * message" claim from the caller, and never exposes whether a
   * message with this id exists at all for a *different* owner — a
   * mismatched-owner id and a genuinely nonexistent id are both
   * `MESSAGE_NOT_FOUND`, same no-enumeration reasoning as
   * `CONVERSATION_NOT_FOUND` above.
   */
  async deleteLastMessage(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    await this.getOwnedConversationOrThrow(ownerId, workspaceId, conversationId);
    const result = await this.repository.deleteMessage(ownerId, workspaceId, conversationId, messageId);
    if (result === "not_found") {
      throw conversationsDomainError("MESSAGE_NOT_FOUND", "Message not found.");
    }
    if (result === "not_last") {
      throw conversationsDomainError(
        "MESSAGE_NOT_LAST",
        "Only the conversation's current last message can be deleted.",
      );
    }
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
    useKnowledge = false,
    requestId?: string,
  ): Promise<SendMessageResponse> {
    await this.getOwnedConversationOrThrow(ownerId, workspaceId, conversationId);

    const claim = await this.beginUserTurn({
      conversationId,
      workspaceId,
      ownerId,
      role: "user",
      content,
      ...(useKnowledge ? { knowledgeRequested: true } : {}),
      ...(requestId ? { requestId } : {}),
    });
    if (claim.completedAssistant) return { userMessage: claim.userMessage, assistantMessage: claim.completedAssistant };
    const requestLease = this.startMessageRequestLease(claim);
    let contextLease: ReturnType<ConversationsService["startKnowledgeReadLease"]> | undefined;
    try {
      await requestLease.assertActive();
      const context = await this.prepareKnowledgeContext(ownerId, workspaceId, content, useKnowledge);
      contextLease = this.startKnowledgeReadLease(context.leases);
      await contextLease.assertActive();
      await requestLease.assertActive();
      const executionSignal = contextLease.signal(requestLease.signal());
      const result = executionSignal
        ? await this.omniCore.execute(context.prompt, { signal: executionSignal })
        : await this.omniCore.execute(context.prompt);
      await contextLease.assertActive();
      await requestLease.assertActive();

      const omniCoreMetadata: MessageOmniCoreMetadata = {
        planId: result.planId,
        intent: result.intent,
        matchedRuleId: result.matchedRuleId,
        confidence: result.confidence,
        providerId: result.providerId,
        modelId: result.modelId,
        taskPlanId: result.execution.taskPlanId,
      };

      const knowledge = await this.finalizeKnowledgeAttribution(ownerId, workspaceId, result.text, context.sources, useKnowledge);
      const answer = useKnowledge ? sanitizeSourceLabels(result.text, new Set(knowledge.citations.map((citation) => citation.sourceId))) : result.text;
      await requestLease.assertActive();
      const assistantInput = {
        conversationId,
        workspaceId,
        ownerId,
        role: "assistant",
        content: answer,
        omniCore: omniCoreMetadata,
        knowledge,
      } as const;
      const assistantMessage: Message = claim.requestId && claim.leaseId
        ? await this.repository.publishAssistantMessage(assistantInput, claim.requestId, claim.leaseId)
        : await this.repository.createMessage(assistantInput);
      await this.repository.touchConversation(conversationId, preview(answer));

      return { userMessage: claim.userMessage, assistantMessage };
    } catch (error) {
      if (claim.requestId && claim.leaseId) await this.repository.markUserMessageRequestRetryable(claim.userMessage.id, claim.requestId, claim.leaseId).catch(() => undefined);
      throw error;
    } finally {
      await contextLease?.stop();
      await requestLease.stop();
    }
  }

  /**
   * The streaming counterpart to `sendMessage()` (Phase 6 Step 2).
   * An async generator, not a callback/emitter: the controller
   * consumes it with `for await`/`.next()` and is the only place SSE
   * framing (`event:`/`data:` lines) happens — this method only ever
   * produces already-typed `MessageStreamEvent` values, so it stays
   * fully testable without an HTTP server or a real `Response` object.
   *
   * Mirrors the exact ordering the Phase 6 Step 2 spec's "LOCKED
   * PERSISTENCE SEMANTICS" requires:
   *   1-2. Ownership is resolved via the same
   *        `getOwnedConversationOrThrow()` `sendMessage()` uses — same
   *        `CONVERSATION_NOT_FOUND` behavior, no separate workspace
   *        pre-check (see that method's doc comment for why).
   *   3. The user message is persisted before anything else can fail.
   *   4. `OmniCoreService.executeStream()` is awaited next — everything
   *      that call can fail on (classification, planning, model
   *      selection) happens here, still before this generator's first
   *      `yield`, i.e. still before the controller can have opened SSE
   *      response headers.
   *   5. Only once that promise resolves does this generator `yield`
   *      its first event (`start`) — the controller's cue to open
   *      headers and begin writing frames.
   *   6. Deltas are accumulated locally (`accumulated`) as they're
   *      yielded, so the full text is always available for step 7
   *      regardless of how the loop below ends.
   *   7. Exactly one assistant message is persisted — either after the
   *      loop completes normally (`status: "complete"`) or from the
   *      `catch` block below if any non-empty text had already been
   *      accumulated before the failure (`status: "incomplete"`).
   *      Never both, and never an empty assistant message: the `catch`
   *      block only persists when `accumulated.length > 0`.
   *
   * Every failure this generator's `catch` block sees — the caller's
   * own `AbortSignal` firing (client disconnect or explicit
   * cancellation, surfaced by `OmniCoreService.executeStream`'s
   * downstream layers as `EXECUTION_CANCELLED`) or a genuine mid-stream
   * provider error — is handled identically: persist whatever
   * non-empty text was accumulated as `"incomplete"`, then yield one
   * terminal `error` event carrying the already-normalized
   * `{code, message}` a domain `HttpException` already carries (see
   * `toStreamErrorPayload` below) — never a raw stack trace, SDK
   * internals, or prompt content. Whether that `error` event actually
   * reaches a client (versus a connection that's already gone) is the
   * controller's concern, not this method's — see
   * `ConversationsController.sendMessageStream`'s own writer, which
   * guards every write against an already-closed response.
   */
  async *sendMessageStream(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    content: string,
    signal: AbortSignal,
    useKnowledge = false,
    requestId?: string,
  ): AsyncGenerator<MessageStreamEvent> {
    await this.getOwnedConversationOrThrow(ownerId, workspaceId, conversationId);
    const claim = await this.beginUserTurn({
      conversationId,
      workspaceId,
      ownerId,
      role: "user",
      content,
      ...(useKnowledge ? { knowledgeRequested: true } : {}),
      ...(requestId ? { requestId } : {}),
    });
    const userMessage = claim.userMessage;
    if (claim.completedAssistant) {
      yield { event: "start", data: { userMessage, assistantExpected: false } };
      yield { event: "done", data: { assistantMessage: claim.completedAssistant } };
      return;
    }
    const requestLease = this.startMessageRequestLease(claim);

    // Same "not wrapped in try/catch" reasoning `sendMessage()` already
    // documents: a failure here (classification, planning, model
    // selection all still fully synchronous/network-free at this point)
    // must propagate to the caller as a normal thrown error — the
    // controller has not opened SSE headers yet, so this is still an
    // ordinary HTTP error response, not a stream event.
    let context: { prompt: string; sources: Array<{ label: string; source: RetrievedKnowledgeSource }>; leases: KnowledgeReadLease[] };
    try {
      await requestLease.assertActive();
      context = await this.prepareKnowledgeContext(ownerId, workspaceId, content, useKnowledge);
      await requestLease.assertActive();
    } catch (error) {
      // The user turn has already been persisted. Start the stream so the
      // client reconciles that exact message, then deliver the retrieval
      // failure as a terminal event instead of leaving an invisible turn.
      if (claim.requestId && claim.leaseId) await this.repository.markUserMessageRequestRetryable(userMessage.id, claim.requestId, claim.leaseId).catch(() => undefined);
      yield { event: "start", data: { userMessage, assistantExpected: false } };
      yield { event: "error", data: { ...toStreamErrorPayload(error), assistantMessagePersisted: false, retryable: true } };
      await requestLease.stop();
      return;
    }
    const contextLease = this.startKnowledgeReadLease(context.leases);
    let result: Awaited<ReturnType<OmniCoreService["executeStream"]>>;
    try {
      await contextLease.assertActive();
      const leaseSignal = contextLease.signal(requestLease.signal(signal));
      result = await this.omniCore.executeStream(context.prompt, { signal: leaseSignal });
      await contextLease.assertActive();
    } catch (error) {
      await contextLease.stop();
      if (claim.requestId && claim.leaseId) await this.repository.markUserMessageRequestRetryable(userMessage.id, claim.requestId, claim.leaseId).catch(() => undefined);
      await requestLease.stop();
      throw error;
    }

    yield { event: "start", data: { userMessage } };

    const omniCoreMetadata: MessageOmniCoreMetadata = {
      planId: result.planId,
      intent: result.intent,
      matchedRuleId: result.matchedRuleId,
      confidence: result.confidence,
      providerId: result.providerId,
      modelId: result.modelId,
      taskPlanId: result.taskPlan.taskPlanId,
    };

    let accumulated = "";
    let pendingText = "";
    const allowedLabels = new Set(context.sources.map((source) => source.label));
    try {
      for await (const chunk of result.textStream) {
        await requestLease.assertActive();
        await contextLease.assertActive();
        pendingText += chunk;
        const splitAt = pendingText.lastIndexOf("[");
        const safeLength = splitAt >= 0 && pendingText.length - splitAt <= 16 ? splitAt : pendingText.length;
        if (safeLength > 0) {
          const safeChunk = useKnowledge ? sanitizeSourceLabels(pendingText.slice(0, safeLength), allowedLabels) : pendingText.slice(0, safeLength);
          pendingText = pendingText.slice(safeLength);
          if (safeChunk) {
            accumulated += safeChunk;
            yield { event: "delta", data: { text: safeChunk } };
          }
        }
      }

      const tail = useKnowledge ? sanitizeSourceLabels(pendingText, allowedLabels) : pendingText;
      if (tail) { accumulated += tail; yield { event: "delta", data: { text: tail } }; }
      const knowledge = await this.finalizeKnowledgeAttribution(ownerId, workspaceId, accumulated, context.sources, useKnowledge);
      const answer = useKnowledge ? sanitizeSourceLabels(accumulated, new Set(knowledge?.citations.map((citation) => citation.sourceId) ?? [])) : accumulated;

      await requestLease.assertActive();
      await contextLease.assertActive();
      const assistantInput = {
        conversationId,
        workspaceId,
        ownerId,
        role: "assistant",
        content: answer,
        omniCore: omniCoreMetadata,
        status: "complete",
        ...(knowledge ? { knowledge } : {}),
      } as const;
      const assistantMessage: Message = claim.requestId && claim.leaseId
        ? await this.repository.publishAssistantMessage(assistantInput, claim.requestId, claim.leaseId)
        : await this.repository.createMessage(assistantInput);
      await this.repository.touchConversation(conversationId, preview(answer));

      yield { event: "done", data: { assistantMessage } };
    } catch (error) {
      if (accumulated.length > 0) {
        const knowledge = await this.finalizeKnowledgeAttribution(ownerId, workspaceId, accumulated, context.sources, useKnowledge);
        const partialAnswer = useKnowledge ? sanitizeSourceLabels(accumulated, new Set(knowledge?.citations.map((citation) => citation.sourceId) ?? [])) : accumulated;
        await requestLease.assertActive();
        const incompleteInput = {
          conversationId,
          workspaceId,
          ownerId,
          role: "assistant",
          content: partialAnswer,
          omniCore: omniCoreMetadata,
          status: "incomplete",
          ...(knowledge ? { knowledge } : {}),
        } as const;
        if (claim.requestId && claim.leaseId) {
          await this.repository.persistIncompleteAssistantAttempt(incompleteInput, claim.requestId, claim.leaseId).catch(() => undefined);
          await this.repository.markUserMessageRequestRetryable(userMessage.id, claim.requestId, claim.leaseId).catch(() => undefined);
        } else {
          await this.repository.createMessage(incompleteInput);
          await this.repository.touchConversation(conversationId, preview(partialAnswer));
        }
      }

      if (claim.requestId && claim.leaseId && accumulated.length === 0) await this.repository.markUserMessageRequestRetryable(userMessage.id, claim.requestId, claim.leaseId).catch(() => undefined);
      yield { event: "error", data: toStreamErrorPayload(error) };
    } finally {
      await contextLease.stop();
      await requestLease.stop();
    }
  }

  private async prepareKnowledgeContext(
    ownerId: string,
    workspaceId: string,
    content: string,
    useKnowledge: boolean,
  ): Promise<{ prompt: string; sources: Array<{ label: string; source: RetrievedKnowledgeSource }>; leases: KnowledgeReadLease[] }> {
    if (!useKnowledge) return { prompt: content, sources: [], leases: [] };
    const retrieved = await this.knowledgeRetrieval.retrieve(ownerId, workspaceId, content);
    const retrievedSources = retrieved.sources ?? retrieved;
    const leases = retrieved.leases ?? [];
    if (!retrievedSources.length) return { prompt: content, sources: [], leases };
    try {
      const built = this.knowledgeContext.build(content, retrievedSources);
      return { ...built, leases };
    } catch (error) {
      await this.knowledgeRetrieval.releaseLeases?.(leases).catch(() => undefined);
      throw error;
    }
  }

  private startKnowledgeReadLease(leases: readonly KnowledgeReadLease[]) {
    let stopped = false;
    let lost = false;
    const controller = new AbortController();
    const timer = leases.length ? setInterval(() => {
      void this.knowledgeRetrieval.renewLeases?.(leases).then((ok: boolean) => { if (!ok) { lost = true; controller.abort(); } }).catch(() => { lost = true; controller.abort(); });
    }, 30_000) : undefined;
    timer?.unref();
    return {
      assertActive: async () => {
        if (lost) throw conversationsDomainError("KNOWLEDGE_READ_LEASE_EXPIRED", "Knowledge context is no longer available. Please retry.");
        await this.knowledgeRetrieval.assertLeases?.(leases);
      },
      signal: (caller?: AbortSignal) => caller && leases.length ? AbortSignal.any([caller, controller.signal]) : caller ?? (leases.length ? controller.signal : undefined),
      stop: async () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearInterval(timer);
        await this.knowledgeRetrieval.releaseLeases?.(leases).catch(() => undefined);
      },
    };
  }

  private async beginUserTurn(input: Parameters<ConversationsRepository["beginUserMessageRequest"]>[0]): Promise<UserMessageRequestClaim> {
    if (typeof this.repository.beginUserMessageRequest !== "function") return { userMessage: await this.repository.createMessage(input) };
    return this.repository.beginUserMessageRequest(input);
  }

  private startMessageRequestLease(claim: UserMessageRequestClaim): {
    assertActive: () => Promise<void>;
    signal: (callerSignal?: AbortSignal) => AbortSignal | undefined;
    stop: () => Promise<void>;
  } {
    if (!claim.requestId || !claim.leaseId) return { assertActive: async () => undefined, signal: (s) => s, stop: async () => undefined };
    const controller = new AbortController();
    const heartbeat = setInterval(() => {
      void this.repository.heartbeatUserMessageRequest(claim.userMessage.id, claim.requestId!, claim.leaseId!).catch(() => controller.abort());
    }, 60_000);
    heartbeat.unref();
    return {
      assertActive: async () => {
        if (controller.signal.aborted) throw conversationsDomainError("MESSAGE_REQUEST_FENCED", "This response attempt is no longer active.");
        await this.repository.assertUserMessageRequest(claim.userMessage.id, claim.requestId!, claim.leaseId!);
      },
      signal: (callerSignal) => callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal,
      stop: async () => { clearInterval(heartbeat); },
    };
  }

  private async finalizeKnowledgeAttribution(
    ownerId: string,
    workspaceId: string,
    answer: string,
    sources: readonly { label: string; source: RetrievedKnowledgeSource }[],
    useKnowledge: boolean,
  ): Promise<KnowledgeMessageAttribution> {
    if (!useKnowledge) return { grounding: "NO_KNOWLEDGE", citations: [] };
    const referenced = new Set([...answer.matchAll(/\[(S\d+)\]/gu)].map((match) => match[1]).filter((label): label is string => Boolean(label)));
    const candidates = sources.filter((item) => referenced.has(item.label));
    let validated: RetrievedKnowledgeSource[];
    try {
      validated = await this.knowledgeRetrieval.validateSources(ownerId, workspaceId, candidates.map((item) => item.source));
    } catch {
      return { grounding: "RETRIEVAL_UNAVAILABLE", citations: [] };
    }
    const validatedById = new Map(validated.map((source) => [source.chunkId, source]));
    const citations: Citation[] = [];
    const seen = new Set<string>();
    for (const item of candidates) {
      const source = validatedById.get(item.source.chunkId);
      if (!source || seen.has(source.chunkId)) continue;
      seen.add(source.chunkId);
      citations.push({
        id: source.chunkId,
        sourceId: item.label,
        fileId: source.fileId,
        fileName: source.fileName,
        chunkId: source.chunkId,
        chunkIndex: source.chunkIndex,
        ...(source.pageNumbers ? { pageNumbers: source.pageNumbers } : {}),
        retrievalScore: source.score,
        excerpt: source.text.slice(0, 240),
        excerptKind: "GENERAL_SOURCE_EXCERPT",
      });
    }
    // A valid source label proves only that the model referenced an actual
    // retrieved source. This pipeline has no claim-entailment verifier, so
    // it must never describe that reference as grounded support.
    return { grounding: citations.length ? "SOURCE_REFERENCED" : "NOT_GROUNDED", citations };
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

function sanitizeSourceLabels(text: string, allowedLabels: ReadonlySet<string>): string {
  return text.replace(/\[(S\d+)\]/gu, (marker, label: string) => allowedLabels.has(label) ? marker : "");
}

/**
 * Normalizes anything `sendMessageStream()`'s loop can catch into the
 * `{code, message}` shape the LOCKED EVENT CONTRACT's `error` event
 * requires. Every error this repository's domain layers actually
 * throw is already an `HttpException` whose response body is exactly
 * `{code, message}` — see `omniCoreDomainError`/`aiDomainError`/
 * `conversationsDomainError` — so the common case here is reading that
 * shape back out, never inventing new error text. The fallback branch
 * (a non-`HttpException`, or one whose body doesn't match) exists only
 * as a defensive last resort and deliberately never includes
 * `error.message`/`error.stack` themselves in the emitted payload —
 * that could be a raw SDK/Node error string, which is exactly the
 * "stack traces, raw SDK internals" this event must never expose.
 */
function toStreamErrorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (
      response &&
      typeof response === "object" &&
      typeof (response as { code?: unknown }).code === "string" &&
      typeof (response as { message?: unknown }).message === "string"
    ) {
      return {
        code: (response as { code: string }).code,
        message: (response as { message: string }).message,
      };
    }
  }
  return { code: "INTERNAL_ERROR", message: "An unexpected error occurred while generating a response." };
}
