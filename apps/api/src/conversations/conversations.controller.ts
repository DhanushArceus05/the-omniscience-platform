import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  conversationIdParamSchema,
  createConversationRequestSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageRequestSchema,
  workspaceIdParamSchema,
  type ListConversationsQuerySchema,
  type ListMessagesQuerySchema,
  type SendMessageRequestSchema,
} from "@omniscience/schemas";
import type {
  ApiSuccess,
  CreateConversationResponse,
  GetConversationResponse,
  ListConversationsResponse,
  ListMessagesResponse,
  SendMessageResponse,
} from "@omniscience/types";
import type { AccessTokenPayload } from "../auth/access-token.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ConversationsService } from "./conversations.service";

/**
 * Conversation & message endpoints (Phase 6 Step 1 — Conversation &
 * Message Persistence Foundation). Create/list/get for conversations,
 * list/send for messages — no update, delete, rename, or streaming in
 * this step.
 *
 * Every route sits behind `JwtAuthGuard` and pulls the caller's id
 * from `@CurrentUser()`, never from the request body, URL, or query —
 * same convention `WorkspacesController` already established.
 * `POST`/`GET .../conversations` verify workspace ownership directly
 * (via `ConversationsService` calling `WorkspacesService.getById()`),
 * giving `404 WORKSPACE_NOT_FOUND` for a workspace the caller doesn't
 * own. The three conversation-scoped routes below
 * (`GET`/`POST .../conversations/:conversationId[...]`) do not check
 * workspace ownership separately — see `ConversationsService.getConversation()`'s
 * doc comment for why — and instead give the identical
 * `404 CONVERSATION_NOT_FOUND` whether the workspace, the conversation,
 * or both aren't the caller's.
 *
 * `GET` routes carry no `@Throttle()` override — authenticated reads
 * with no credential or vendor cost involved use the existing app-wide
 * default, same reasoning `WorkspacesController`'s `GET` routes
 * already document. `POST .../conversations` gets `WorkspacesController`'s
 * own `create`-route limit (20/10min) — a write action, no vendor
 * cost. `POST .../messages` gets `OmniCoreController.execute()`'s
 * tight limit (10/10min) verbatim, since it makes the exact same
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
}
