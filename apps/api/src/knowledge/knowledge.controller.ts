import {
  Controller,
  Delete,
  BadRequestException,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { knowledgeFileIdParamSchema, workspaceIdParamSchema } from "@omniscience/schemas";
import type {
  ApiSuccess,
  DeleteKnowledgeFileResponse,
  GetKnowledgeFileResponse,
  ListKnowledgeFilesResponse,
  UploadKnowledgeFileResponse,
} from "@omniscience/types";
import type { Response } from "express";
import type { AccessTokenPayload } from "../auth/access-token.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { KnowledgeFileUploadInput } from "./knowledge-storage.service";
import { KnowledgeStorageService } from "./knowledge-storage.service";
import { KnowledgeService } from "./knowledge.service";

/**
 * Phase 7 Step 1 — knowledge file management endpoints.
 *
 * All endpoints are behind `JwtAuthGuard` and workspace-ownership-checked.
 * Upload is throttled to prevent abuse.
 */
@Controller("workspaces/:workspaceId/knowledge")
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly storage: KnowledgeStorageService,
  ) {}

  /**
   * POST /workspaces/:workspaceId/knowledge/upload
   *
   * Uploads a new knowledge file (PDF/DOCX/TXT, max 25MB by default).
   * Throttled to 10 requests per minute to prevent upload abuse.
   */
  @Post("upload")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        // Generous DoS backstop (50MB) — the authoritative limit is
        // `KNOWLEDGE_FILE_SIZE_LIMIT_MB` enforced by KnowledgeStorageService
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  async upload(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ApiSuccess<UploadKnowledgeFileResponse>> {
    if (!file) {
      throw new BadRequestException({
        code: "KNOWLEDGE_FILE_REQUIRED",
        message: "A file is required.",
      });
    }
    const input: KnowledgeFileUploadInput = {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
    return { success: true, data: await this.knowledge.upload(user.sub, workspaceId, input) };
  }

  /**
   * GET /workspaces/:workspaceId/knowledge
   *
   * Lists all knowledge files in the workspace (newest-first).
   */
  @Get()
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
  ): Promise<ApiSuccess<ListKnowledgeFilesResponse>> {
    return { success: true, data: await this.knowledge.list(user.sub, workspaceId) };
  }

  /**
   * GET /workspaces/:workspaceId/knowledge/:fileId
   *
   * Gets a single knowledge file's metadata.
   */
  @Get(":fileId")
  async getById(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Param("fileId", new ZodValidationPipe(knowledgeFileIdParamSchema)) fileId: string,
  ): Promise<ApiSuccess<GetKnowledgeFileResponse>> {
    return { success: true, data: await this.knowledge.getById(user.sub, workspaceId, fileId) };
  }

  /**
   * DELETE /workspaces/:workspaceId/knowledge/:fileId
   *
   * Deletes a knowledge file and its stored content.
   */
  @Delete(":fileId")
  async delete(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Param("fileId", new ZodValidationPipe(knowledgeFileIdParamSchema)) fileId: string,
  ): Promise<ApiSuccess<DeleteKnowledgeFileResponse>> {
    return { success: true, data: await this.knowledge.delete(user.sub, workspaceId, fileId) };
  }

  /**
   * GET /workspaces/:workspaceId/knowledge/:fileId/download
   *
   * Downloads the raw knowledge file content.
   * Sets appropriate Content-Disposition and Content-Type headers.
   */
  @Get(":fileId/download")
  async download(
    @CurrentUser() user: AccessTokenPayload,
    @Param("workspaceId", new ZodValidationPipe(workspaceIdParamSchema)) workspaceId: string,
    @Param("fileId", new ZodValidationPipe(knowledgeFileIdParamSchema)) fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, originalName, mimeType } = await this.knowledge.readFile(
      user.sub,
      workspaceId,
      fileId,
    );

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${originalName}"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  }
}
