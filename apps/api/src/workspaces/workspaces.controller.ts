import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  createWorkspaceRequestSchema,
  listWorkspacesQuerySchema,
  workspaceIdParamSchema,
  type CreateWorkspaceRequestSchema,
  type ListWorkspacesQuerySchema,
} from "@omniscience/schemas";
import type {
  ApiSuccess,
  CreateWorkspaceResponse,
  GetWorkspaceResponse,
  ListWorkspacesResponse,
} from "@omniscience/types";
import type { AccessTokenPayload } from "../auth/access-token.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { WorkspacesService } from "./workspaces.service";

/**
 * Workspace endpoints (Phase 3 Step 2 — Workspace Data Model, Ownership
 * Isolation & Dashboard Listing). Create/list/get only — no update or
 * delete in this step.
 *
 * All three routes sit behind `JwtAuthGuard` (Phase 2 Step 4) and pull
 * the caller's id from `@CurrentUser()`, never from the request body,
 * URL, or query — same convention `UsersController` (Step 6) already
 * established.
 *
 * `GET /workspaces` and `GET /workspaces/:id` intentionally carry no
 * `@Throttle()` override: they're authenticated reads with no
 * credential involved, so the existing app-wide default (60 requests /
 * 60s per IP, from `ThrottlerModule.forRoot` in `app.module.ts`) is the
 * right limit, not an arbitrarily tighter one. `POST /workspaces` gets a
 * stricter, explicit limit (20/10min) matching `UsersController`'s
 * `update-profile` precedent — a write action, but not one that changes
 * a credential.
 */
@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(createWorkspaceRequestSchema)) body: CreateWorkspaceRequestSchema,
  ): Promise<ApiSuccess<CreateWorkspaceResponse>> {
    const data = await this.workspacesService.create(user.sub, body.name, body.description);
    return { success: true, data };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodValidationPipe(listWorkspacesQuerySchema)) query: ListWorkspacesQuerySchema,
  ): Promise<ApiSuccess<ListWorkspacesResponse>> {
    const data = await this.workspacesService.listForOwner(user.sub, query);
    return { success: true, data };
  }

  @Get(":id")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getById(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id", new ZodValidationPipe(workspaceIdParamSchema)) id: string,
  ): Promise<ApiSuccess<GetWorkspaceResponse>> {
    const data = await this.workspacesService.getById(user.sub, id);
    return { success: true, data };
  }
}
