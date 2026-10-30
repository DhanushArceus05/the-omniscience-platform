import { randomUUID } from "node:crypto";
import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type { KnowledgeFileStatus } from "@prisma/client";
import { ENV } from "../config/config.constants";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { DocumentExtractionService } from "./document-extraction.service";
import { KnowledgeChunkingService } from "./knowledge-chunking.service";
import { KnowledgeChunksRepository } from "./knowledge-chunks.repository";
import { KnowledgeEmbeddingService } from "./knowledge-embedding.service";
import { KnowledgeStorageService } from "./knowledge-storage.service";
import { deterministicPointId, KnowledgeVectorsService } from "./knowledge-vectors.service";

const STALE_PROCESSING_LEASE_MS = 30 * 60 * 1000;
const ACTIVE_PROCESSING_STATUSES = ["PROCESSING", "EXTRACTED", "EMBEDDING_PENDING"] as const;

interface KnowledgeLifecycleRow {
  id: string;
  ownerId: string;
  workspaceId: string;
  status: KnowledgeFileStatus;
  storageKey: string;
  mimeType: string;
  updatedAt: Date;
  processingAttemptId: string | null;
  activeGenerationId: string | null;
  chunkCount: number | null;
}

export interface DeletionClaim {
  file: KnowledgeLifecycleRow;
  attemptId: string;
}

class AttemptFencedError extends Error {}

@Injectable()
export class KnowledgeProcessingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly storage: KnowledgeStorageService,
    private readonly extraction: DocumentExtractionService,
    private readonly chunking: KnowledgeChunkingService,
    private readonly chunks: KnowledgeChunksRepository,
    private readonly embeddings: KnowledgeEmbeddingService,
    private readonly vectors: KnowledgeVectorsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async process(ownerId: string, workspaceId: string, fileId: string): Promise<{ fileId: string; status: "READY"; chunkCount: number }> {
    await this.workspaces.getById(ownerId, workspaceId);
    const file = await this.prisma.knowledgeFile.findFirst({ where: { id: fileId, workspaceId, ownerId } }) as KnowledgeLifecycleRow | null;
    if (!file) throw new NotFoundException({ code: "KNOWLEDGE_FILE_NOT_FOUND", message: "File not found." });
    if (file.status === "DELETING") throw lifecycleConflict();
    if (file.processingAttemptId && Date.now() - file.updatedAt.getTime() < STALE_PROCESSING_LEASE_MS) throw lifecycleConflict();

    const attemptId = randomUUID();
    const claim = await this.prisma.knowledgeFile.updateMany({
      where: { id: fileId, workspaceId, ownerId, status: file.status, updatedAt: file.updatedAt, processingAttemptId: file.processingAttemptId },
      data: { status: "PROCESSING", processingAttemptId: attemptId, failureReason: null },
    });
    if (claim.count !== 1) throw lifecycleConflict();

    const generationId = attemptId;
    let stage: "EXTRACTION" | "CHUNK_PERSISTENCE" | "EMBEDDING" | "VECTOR_INDEXING" = "EXTRACTION";
    try {
      await this.assertAttempt(ownerId, workspaceId, fileId, attemptId);
      const buffer = await this.storage.read(file.storageKey);
      const extracted = await this.extraction.extract(buffer, file.mimeType);
      await this.assertAttempt(ownerId, workspaceId, fileId, attemptId);

      stage = "CHUNK_PERSISTENCE";
      const chunkData = this.chunking.chunk(extracted);
      const persisted = await this.withAttemptWriteLock(ownerId, workspaceId, fileId, attemptId,
        () => this.chunks.replace(workspaceId, fileId, generationId, chunkData));
      await this.transition(ownerId, workspaceId, fileId, attemptId, "PROCESSING", "EXTRACTED", {});
      await this.transition(ownerId, workspaceId, fileId, attemptId, "EXTRACTED", "EMBEDDING_PENDING", {});

      stage = "EMBEDDING";
      const batchSource = this.embeddings.embedBatches(persisted);
      for await (const batch of batchSource) {
        await this.assertAttempt(ownerId, workspaceId, fileId, attemptId);
        stage = "VECTOR_INDEXING";
        await this.withAttemptWriteLock(ownerId, workspaceId, fileId, attemptId,
          () => this.vectors.upsertBatch(workspaceId, fileId, generationId, batch));
        await this.heartbeat(ownerId, workspaceId, fileId, attemptId);
        stage = "EMBEDDING";
      }

      await this.assertAttempt(ownerId, workspaceId, fileId, attemptId);
      stage = "VECTOR_INDEXING";
      const desired = new Set(persisted.map((chunk) => deterministicPointId(workspaceId, fileId, generationId, chunk.chunkIndex)));
      await this.withAttemptWriteLock(ownerId, workspaceId, fileId, attemptId,
        () => this.vectors.reconcileGeneration(workspaceId, fileId, generationId, desired));

      const published = await this.prisma.knowledgeFile.updateMany({
        where: { id: fileId, workspaceId, ownerId, status: "EMBEDDING_PENDING", processingAttemptId: attemptId },
        data: { status: "READY", activeGenerationId: generationId, processingAttemptId: null, chunkCount: persisted.length, failureReason: null },
      });
      if (published.count !== 1) throw new AttemptFencedError("Processing attempt was fenced before publish.");

      // The active generation is already published. Old-generation cleanup is
      // idempotent and the periodic reconciler retries it if either store fails.
      if (file.activeGenerationId && file.activeGenerationId !== generationId) {
        await this.cleanupGeneration(workspaceId, fileId, file.activeGenerationId).catch(() => undefined);
      }
      return { fileId, status: "READY", chunkCount: persisted.length };
    } catch (error) {
      if (error instanceof AttemptFencedError) throw lifecycleConflict();
      const failureReason = stage === "EXTRACTION" ? "EXTRACTION_FAILED"
        : stage === "CHUNK_PERSISTENCE" ? "CHUNK_PERSISTENCE_FAILED"
          : stage === "EMBEDDING" ? "EMBEDDING_FAILED" : "VECTOR_INDEXING_FAILED";
      let failedCount = 0;
      try {
        const failed = await this.prisma.knowledgeFile.updateMany({
          where: { id: fileId, workspaceId, ownerId, processingAttemptId: attemptId, status: { in: [...ACTIVE_PROCESSING_STATUSES] } },
          data: file.activeGenerationId
            ? { status: "READY", processingAttemptId: null, failureReason: null, chunkCount: file.chunkCount }
            : { status: "FAILED", processingAttemptId: null, chunkCount: null, failureReason },
        });
        failedCount = failed.count;
      } catch {
        throw new ServiceUnavailableException({ code: "KNOWLEDGE_PROCESSING_STATE_UNAVAILABLE", message: "Processing state could not be saved. Please retry processing." });
      }
      if (failedCount !== 1) throw lifecycleConflict();
      await this.cleanupGeneration(workspaceId, fileId, generationId).catch(() => undefined);
      if (stage === "EXTRACTION" && isSafeExtractionError(error)) throw error;
      throw new ServiceUnavailableException({ code: `KNOWLEDGE_${failureReason}`, message: "Document processing failed. Please retry processing." });
    }
  }

  /** Claims deletion and fences processing before any artifact cleanup begins. */
  async claimDeletion(ownerId: string, workspaceId: string, fileId: string): Promise<DeletionClaim> {
    await this.workspaces.getById(ownerId, workspaceId);
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<KnowledgeLifecycleRow[]>`
        SELECT "id", "ownerId", "workspaceId", "status", "storageKey", "mimeType", "updatedAt",
          "processingAttemptId", "activeGenerationId", "chunkCount"
        FROM "knowledge_files"
        WHERE "id" = ${fileId} AND "workspaceId" = ${workspaceId} AND "ownerId" = ${ownerId}
        FOR UPDATE
      `;
      const file = rows[0];
      if (!file) throw new NotFoundException({ code: "KNOWLEDGE_FILE_NOT_FOUND", message: "File not found." });
      if (file.status === "DELETING" && file.processingAttemptId && Date.now() - file.updatedAt.getTime() < STALE_PROCESSING_LEASE_MS) throw lifecycleConflict();
      const attemptId = randomUUID();
      const claimed = await transaction.knowledgeFile.updateMany({
        where: { id: fileId, workspaceId, ownerId, status: file.status, updatedAt: file.updatedAt, processingAttemptId: file.processingAttemptId },
        data: { status: "DELETING", processingAttemptId: attemptId },
      });
      if (claimed.count !== 1) throw lifecycleConflict();
      return { file, attemptId };
    }, { maxWait: 10_000, timeout: this.env.AI_REQUEST_TIMEOUT_MS + 10_000 });
  }

  async releaseDeletion(claim: DeletionClaim): Promise<void> {
    await this.prisma.knowledgeFile.updateMany({
      where: { id: claim.file.id, workspaceId: claim.file.workspaceId, ownerId: claim.file.ownerId, status: "DELETING", processingAttemptId: claim.attemptId },
      data: { processingAttemptId: null },
    });
  }

  async finishDeletion(claim: DeletionClaim): Promise<void> {
    await this.prisma.knowledgeFile.deleteMany({
      where: { id: claim.file.id, workspaceId: claim.file.workspaceId, ownerId: claim.file.ownerId, status: "DELETING", processingAttemptId: claim.attemptId },
    });
  }

  async cleanupDeletionArtifacts(workspaceId: string, fileId: string): Promise<void> {
    await this.vectors.deleteFile(workspaceId, fileId);
    await this.chunks.deleteFile(workspaceId, fileId);
  }

  private async cleanupGeneration(workspaceId: string, fileId: string, generationId: string): Promise<void> {
    await this.vectors.deleteGeneration(workspaceId, fileId, generationId);
    await this.chunks.deleteGeneration(workspaceId, fileId, generationId);
  }

  private async assertAttempt(ownerId: string, workspaceId: string, fileId: string, attemptId: string): Promise<void> {
    const current = await this.prisma.knowledgeFile.findFirst({
      where: { id: fileId, workspaceId, ownerId, processingAttemptId: attemptId, status: { in: [...ACTIVE_PROCESSING_STATUSES] } },
      select: { id: true },
    });
    if (!current) throw new AttemptFencedError("Processing attempt is no longer active.");
  }

  /** Holds the PostgreSQL row lock across each bounded external write so deletion cannot clean ahead of an in-flight write. */
  private async withAttemptWriteLock<T>(ownerId: string, workspaceId: string, fileId: string, attemptId: string, write: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "knowledge_files"
        WHERE "id" = ${fileId} AND "workspaceId" = ${workspaceId} AND "ownerId" = ${ownerId}
          AND "processingAttemptId" = ${attemptId}
          AND "status" IN ('PROCESSING', 'EXTRACTED', 'EMBEDDING_PENDING')
        FOR UPDATE
      `;
      if (rows.length !== 1) throw new AttemptFencedError("Processing attempt is no longer active.");
      return write();
    }, { maxWait: 10_000, timeout: this.env.AI_REQUEST_TIMEOUT_MS + 10_000 });
  }

  private async transition(
    ownerId: string, workspaceId: string, fileId: string, attemptId: string,
    from: "PROCESSING" | "EXTRACTED", to: "EXTRACTED" | "EMBEDDING_PENDING", extra: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.prisma.knowledgeFile.updateMany({
      where: { id: fileId, workspaceId, ownerId, status: from, processingAttemptId: attemptId },
      data: { status: to, ...extra },
    });
    if (result.count !== 1) throw new AttemptFencedError("Processing attempt was fenced during transition.");
  }

  private async heartbeat(ownerId: string, workspaceId: string, fileId: string, attemptId: string): Promise<void> {
    const result = await this.prisma.knowledgeFile.updateMany({
      where: { id: fileId, workspaceId, ownerId, status: "EMBEDDING_PENDING", processingAttemptId: attemptId },
      data: { updatedAt: new Date() },
    });
    if (result.count !== 1) throw new AttemptFencedError("Processing attempt was fenced during heartbeat.");
  }
}

function lifecycleConflict(): ConflictException {
  return new ConflictException({ code: "KNOWLEDGE_FILE_LIFECYCLE_BUSY", message: "The file lifecycle changed. Please retry." });
}

function isSafeExtractionError(error: unknown): error is HttpException {
  if (!(error instanceof HttpException)) return false;
  const response = error.getResponse();
  if (typeof response !== "object" || response === null || !("code" in response)) return false;
  return ["KNOWLEDGE_FILE_PASSWORD_REQUIRED", "KNOWLEDGE_FILE_CORRUPT", "KNOWLEDGE_FILE_ENCODING_INVALID", "KNOWLEDGE_FILE_TYPE_UNSUPPORTED", "KNOWLEDGE_EXTRACTION_ERROR"].includes(String(response.code));
}
