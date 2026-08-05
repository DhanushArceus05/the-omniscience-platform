import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  conversationIdParamSchema,
  createConversationRequestSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  renameConversationRequestSchema,
  sendMessageRequestSchema,
  workspaceIdParamSchema,
  type ListConversationsQuerySchema,
  type ListMessagesQuerySchema,
  type RenameConversationRequestSchema,
  type SendMessageRequestSchema,
} from "@omniscience/schemas";
import type {
  ApiSuccess,
  CreateConversationResponse,
  DeleteConversationResponse,
  GetConversationResponse,
  ListConversationsResponse,
  ListMessagesResponse,
  MessageStreamEvent,
  RenameConversationResponse,
  SendMessageResponse,
} from "@omniscience/types";
import type { AccessTokenPayload } from "../auth/access-token.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ConversationsService } from "./conversations.service";

/**
 * Conversation & message endpoints (Phase 6 Step 1 — Conversation &
 * Message Persistence Foundation; extended in Phase 6 Step 2 with
 * `sendMessageStream`, backend-only authenticated assistant response
 * streaming; extended in Phase 6 Step 4 with `rename`/`remove`,
 * Conversation Management). Create/list/get/rename/delete for
 * conversations, list/send/stream-send for messages.
 *
 * Every route sits behind `JwtAuthGuard` and pulls the caller's id
 * from `@CurrentUser()`, never from the request body, URL, or query —
 * same convention `WorkspacesController` already established.
 * `POST`/`GET .../conversations` verify workspace ownership directly
 * (via `ConversationsService` calling `WorkspacesService.getById()`),
 * giving `404 WORKSPACE_NOT_FOUND` for a workspace the caller doesn't
 * own. The conversation-scoped routes below
 * (`GET`/`POST`/`PATCH`/`DELETE .../conversations/:conversationId[...]`)
 * do not check workspace ownership separately — see
 * `ConversationsService.getConversation()`'s doc comment for why —
 * and instead give the identical `404 CONVERSATION_NOT_FOUND` whether
 * the workspace, the conversation, or both aren't the caller's.
 * `rename`/`remove` preserve this exactly, via the same
 * `getOwnedConversationOrThrow()` path every other conversation-scoped
 * method already uses.
 *
 * `GET` routes carry no `@Throttle()` override — authenticated reads
 * with no credential or vendor cost involved use the existing app-wide
 * default, same reasoning `WorkspacesController`'s `GET` routes
 * already document. `POST .../conversations`, `PATCH .../:conversationId`,
 * and `DELETE .../:conversationId` all get `WorkspacesController`'s own
 * `create`-route limit (20/10min) — ordinary write actions, no vendor
 * cost involved in any of the three. `POST .../messages` and
 * `POST .../messages/stream` both get `OmniCoreController.execute()`'s
 * tight limit (10/10min) verbatim, since both make the exact same
 * vendor-billed call.
 */
@Controller("workspaces/:workspaceId/conversations")
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Body(new ZodValidationPipe(createConversationRequestSchema)) _body: Record<string, never>,
  ): Promise<ApiSuccess<CreateConversationResponse>> {
    const data = await this.conversationsService.createConversation(user.sub, workspaceId);
    return { success: true, data };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Query(new ZodValidationPipe(listConversationsQuerySchema)) query: ListConversationsQuerySchema,
  ): Promise<ApiSuccess<ListConversationsResponse>> {
    const data = await this.conversationsService.listConversations(user.sub, workspaceId, query);
    return { success: true, data };
  }

  @Get(":conversationId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getById(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Param("conversationId", new ZodValidationPipe(conversationIdParamSchema)) conversationId: string,
  ): Promise<ApiSuccess<GetConversationResponse>> {
    const data = await this.conversationsService.getConversation(user.sub, workspaceId, conversationId);
    return { success: true, data };
  }

  /** Phase 6 Step 4 — Conversation Management. */
  @Patch(":conversationId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async rename(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Param("conversationId", new ZodValidationPipe(conversationIdParamSchema)) conversationId: string,
    @Body(new ZodValidationPipe(renameConversationRequestSchema)) body: RenameConversationRequestSchema,
  ): Promise<ApiSuccess<RenameConversationResponse>> {
    const data = await this.conversationsService.renameConversation(
      user.sub,
      workspaceId,
      conversationId,
      body.title,
    );
    return { success: true, data };
  }

  /**
   * Phase 6 Step 4 — Conversation Management. Cascades to every
   * message the conversation owned — see
   * `ConversationsRepository.deleteConversation()`'s doc comment.
   * Irreversible, same as `DELETE /users/me` — no "undo" or
   * grace-period endpoint.
   */
  @Delete(":conversationId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Param("conversationId", new ZodValidationPipe(conversationIdParamSchema)) conversationId: string,
  ): Promise<ApiSuccess<DeleteConversationResponse>> {
    await this.conversationsService.deleteConversation(user.sub, workspaceId, conversationId);
    return { success: true, data: { deleted: true } };
  }

  @Get(":conversationId/messages")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async listMessages(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Param("conversationId", new ZodValidationPipe(conversationIdParamSchema)) conversationId: string,
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: ListMessagesQuerySchema,
  ): Promise<ApiSuccess<ListMessagesResponse>> {
    const data = await this.conversationsService.listMessages(
      user.sub,
      workspaceId,
      conversationId,
      query,
    );
    return { success: true, data };
  }

  /**
   * The user message is persisted before `OmniCoreService.execute()`
   * is ever called (see `ConversationsService.sendMessage()`'s doc
   * comment) — an OmniCore domain error thrown here still leaves that
   * user message reachable via `GET .../messages` afterward.
   */
  @Post(":conversationId/messages")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async sendMessage(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Param("conversationId", new ZodValidationPipe(conversationIdParamSchema)) conversationId: string,
    @Body(new ZodValidationPipe(sendMessageRequestSchema)) body: SendMessageRequestSchema,
  ): Promise<ApiSuccess<SendMessageResponse>> {
    const data = await this.conversationsService.sendMessage(
      user.sub,
      workspaceId,
      conversationId,
      body.content,
    );
    return { success: true, data };
  }

  /**
   * Phase 6 Step 2 — backend-only authenticated assistant response
   * streaming. SSE-formatted events over an authenticated `POST`,
   * deliberately consumed via `fetch()` + `ReadableStream` on the
   * client side rather than the native `EventSource` API: `EventSource`
   * can only issue unauthenticated `GET` requests, so it has no way to
   * attach the `Authorization` header `JwtAuthGuard` requires here (and
   * offers no real reconnection guarantee worth relying on regardless).
   * The future Phase 6 Step 3 chat frontend is the intended `fetch()`
   * consumer of this endpoint — not implemented in this step.
   *
   * Bypasses the `ApiSuccess<T>` envelope every other route in this
   * controller returns: raw `@Res({ passthrough: false })` control is
   * the only way to send the required
   * `Content-Type: text/event-stream` / `Cache-Control: no-cache` /
   * `Connection: keep-alive` / `X-Accel-Buffering: no` headers, hold
   * the response open across multiple writes, and close it exactly
   * once. Nest's own exception handling (`AllExceptionsFilter`) still
   * applies to anything thrown before this method calls
   * `res.writeHead(...)` — ownership resolution, user-message
   * persistence, and OmniCore classification/planning/model selection
   * (`ConversationsService.sendMessageStream()`'s first `await`, before
   * its first `yield`) all still produce an ordinary HTTP error
   * response, per the Phase 6 Step 2 spec's "LOCKED ERROR SEMANTICS."
   * Once streaming begins, `writeStreamEvent` below is the only thing
   * that writes to `res`, and it silently no-ops against an
   * already-closed/destroyed response instead of throwing — the
   * generator itself is always drained to completion regardless (so
   * its persistence side effects always run), even once nothing is
   * listening.
   *
   * Cancellation: one `AbortController` per request, whose `signal` is
   * exactly what `ConversationsService.sendMessageStream()` forwards to
   * `OmniCoreService.executeStream()` → `OmniProvider.generateTextStream()`
   * → the Anthropic SDK's own request-level `signal` option. A `"close"`
   * event on either `req` or `res` — fired on a genuine client
   * disconnect and on an explicit client-side `fetch` abort alike — is
   * the only thing that calls `controller.abort()` (see the listener
   * registration below for why both are wired to the same handler); a
   * normal completion never emits either while this method is still
   * running, which is what keeps a completed response's own trailing
   * `"close"` event from ever being mistaken for a cancellation.
   */
  @Post(":conversationId/messages/stream")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async sendMessageStream(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Param("conversationId", new ZodValidationPipe(conversationIdParamSchema)) conversationId: string,
    @Body(new ZodValidationPipe(sendMessageRequestSchema)) body: SendMessageRequestSchema,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const controller = new AbortController();
    const onDisconnect = (): void => controller.abort();
    // Both `req` and `res` emit `"close"` when the underlying connection
    // is terminated prematurely — Node documents `res`'s specifically
    // for "before the response completed" (exactly a mid-SSE-stream
    // client disconnect, this method's actual cancellation scenario),
    // while `req`'s close is the more general "request lifecycle ended"
    // signal. Listening on both, rather than either alone, is what
    // makes detecting a disconnect reliable regardless of which one a
    // given Node/platform version actually fires promptly for an
    // in-flight streaming response — aborting an already-aborted
    // `AbortController` is a harmless no-op, so there's no risk in
    // wiring both to the same handler.
    req.on("close", onDisconnect);
    res.on("close", onDisconnect);

    // Tracks whether this method itself has already opened the SSE
    // response — see the `finally` block below for why this matters.
    let headersOpened = false;

    try {
      const events = this.conversationsService.sendMessageStream(
        user.sub,
        workspaceId,
        conversationId,
        body.content,
        controller.signal,
      );

      // This first `.next()` runs everything up to and including
      // `OmniCoreService.executeStream()` (ownership, user-message
      // persistence, classification/planning/model selection) — if any
      // of it throws, it does so here, before headers are opened, and
      // this `await` rethrows into Nest's normal exception handling
      // unchanged (see this method's doc comment).
      let result = await events.next();
      if (result.done) {
        // Unreachable in practice: `sendMessageStream()` always yields
        // a `start` event before ever returning — see that method's
        // doc comment. Defensive only, matching this file's existing
        // "guard the invariant, don't silently proceed" convention. Not
        // an error, so it still ends the response cleanly here, rather
        // than leaving the connection to hang.
        res.end();
        return;
      }

      if (!res.writableEnded && !res.destroyed) {
        res.writeHead(HttpStatus.OK, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        headersOpened = true;
      }
      writeStreamEvent(res, result.value);

      // From here on, every failure the generator can hit is already
      // caught and normalized inside `sendMessageStream()` itself into
      // a terminal `error` event — this loop has nothing left to catch.
      result = await events.next();
      while (!result.done) {
        writeStreamEvent(res, result.value);
        result = await events.next();
      }
    } finally {
      req.off("close", onDisconnect);
      res.off("close", onDisconnect);
      // Only close a response this method actually opened. A failure
      // before the first `start` event (ownership, validation, or
      // OmniCore planning/model-selection — see the `await events.next()`
      // above) throws having never called `res.writeHead()`, and that
      // exception must propagate untouched to Nest's own exception
      // handling (`AllExceptionsFilter`), which still owns producing the
      // real HTTP status and JSON body for it — exactly the "LOCKED
      // ERROR SEMANTICS" this method's doc comment describes. Calling
      // `res.end()` unconditionally here would implicitly flush a
      // default `200` response (Node sends default headers on the first
      // `end()`/`write()` if `writeHead` was never called) before that
      // filter ever runs — turning a `404 CONVERSATION_NOT_FOUND` into a
      // `200` with an empty body, and the filter's own attempt to set
      // the real status into a "Cannot set headers after they are sent"
      // crash. This guard is what keeps that from happening.
      if (headersOpened && !res.writableEnded && !res.destroyed) {
        res.end();
      }
    }
  }
}

/** Writes one `MessageStreamEvent` as a correctly framed SSE event — `event: <name>\ndata: <json>\n\n`, always ending with the required blank line. No-ops against a response that can no longer be written to, rather than throwing, so a client disconnect never turns into an unhandled write error partway through draining the generator. */
function writeStreamEvent(res: Response, event: MessageStreamEvent): void {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}
