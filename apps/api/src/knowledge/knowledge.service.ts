import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  DeleteKnowledgeFileResponse,
  GetKnowledgeFileResponse,
  KnowledgeFile,
  ListKnowledgeFilesResponse,
  UploadKnowledgeFileResponse,
} from "@omniscience/types";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { KnowledgeFileUploadInput } from "./knowledge-storage.service";
import { KnowledgeStorageService } from "./knowledge-storage.service";
import { KnowledgeProcessingService } from "./knowledge-processing.service";

/** The minimal shape `toKnowledgeFileResponse` needs from a Prisma row. */
interface KnowledgeFileRow {
  id: string;
  workspaceId: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  status: string;
  chunkCount: number | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Phase 7 Step 1 — knowledge file orchestration service.
 *
 * Orchestrates the file lifecycle: upload, list, get, delete. Every
 * operation is scoped to the caller's own workspace — `ownerId` always
 * comes from the verified JWT payload, never from request input.
 *
 * This step only implements the storage foundation. Document extraction,
 * chunking, and embedding are deferred to Steps 2-4.
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly storage: KnowledgeStorageService,
    private readonly processing: KnowledgeProcessingService,
  ) {}

  /**
   * Uploads a new knowledge file to the caller's workspace.
   * Creates the file record with status `UPLOADED` — processing happens
   * in later steps.
   */
  async upload(
    ownerId: string,
    workspaceId: string,
    input: KnowledgeFileUploadInput,
  ): Promise<UploadKnowledgeFileResponse> {
    // Verify ownership
    await this.workspaces.getById(ownerId, workspaceId);

    // Store file and compute checksum
    const stored = await this.storage.save(input);

    // Sanitize the original filename for storage
    const sanitizedName = this.storage.sanitizeFilename(input.originalname);

    // Create database record
    let file: KnowledgeFileRow;
    try {
      file = await this.prisma.knowledgeFile.create({
        data: {
          workspaceId,
          ownerId,
          originalName: sanitizedName,
          storageKey: stored.storageKey,
          mimeType: input.mimetype,
          fileSize: stored.fileSize,
          checksum: stored.checksum,
          status: "UPLOADED",
        },
      });
      this.storage.markCommitted(stored.storageKey);
    } catch (error) {
      // The generated key is released from the in-flight set. A crash or
      // failed DB insert leaves an orphan eligible for delayed reconciliation.
      this.storage.releasePending(stored.storageKey);
      throw error;
    }

    return { file: toKnowledgeFileResponse(file) };
  }

  /**
   * Lists all knowledge files in the caller's workspace.
   * Newest-first ordering (by `createdAt`).
   */
  async list(ownerId: string, workspaceId: string): Promise<ListKnowledgeFilesResponse> {
    // Verify ownership
    await this.workspaces.getById(ownerId, workspaceId);

    const files = await this.prisma.knowledgeFile.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });

    return { files: files.map(toKnowledgeFileResponse) };
  }

  /**
   * Gets a single knowledge file by ID.
   * Returns 404 if the file doesn't exist or doesn't belong to the
   * caller's workspace (same no-enumeration pattern as `WorkspacesService`).
   */
  async getById(
    ownerId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<GetKnowledgeFileResponse> {
    // Verify ownership
    await this.workspaces.getById(ownerId, workspaceId);

    const file = await this.prisma.knowledgeFile.findUnique({ where: { id: fileId } });
    if (!file || file.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: "KNOWLEDGE_FILE_NOT_FOUND",
        message: "File not found.",
      });
    }

    return { file: toKnowledgeFileResponse(file) };
  }

  /**
   * Deletes a knowledge file and its stored content.
   * Returns 404 if the file doesn't exist or doesn't belong to the
   * caller's workspace.
   */
  async delete(
    ownerId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<DeleteKnowledgeFileResponse> {
    const claim = await this.processing.claimDeletion(ownerId, workspaceId, fileId);
    try {
      // DELETING fences new attempts; the claim waits behind any row-locked
      // external write before these idempotent workspace/file-scoped cleanups.
      await this.processing.cleanupDeletionArtifacts(workspaceId, fileId);
      await this.storage.delete(claim.file.storageKey);
      await this.processing.finishDeletion(claim);
      return { deleted: true };
    } catch (error) {
      await this.processing.releaseDeletion(claim).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Reads the raw file content for download.
   * Returns the file buffer and metadata for setting response headers.
   */
  async readFile(
    ownerId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<{ buffer: Buffer; originalName: string; mimeType: string }> {
    // Verify ownership
    await this.workspaces.getById(ownerId, workspaceId);

    const file = await this.prisma.knowledgeFile.findUnique({ where: { id: fileId } });
    if (!file || file.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: "KNOWLEDGE_FILE_NOT_FOUND",
        message: "File not found.",
      });
    }

    const buffer = await this.storage.read(file.storageKey);
    return {
      buffer,
      originalName: file.originalName,
      mimeType: file.mimeType,
    };
  }
}

function toKnowledgeFileResponse(row: KnowledgeFileRow): KnowledgeFile {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    originalName: row.originalName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    status: row.status as KnowledgeFile["status"],
    chunkCount: row.chunkCount,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
