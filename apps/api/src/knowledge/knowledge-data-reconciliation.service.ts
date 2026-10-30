import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Logger } from "pino";
import { LOGGER } from "../config/config.constants";
import { PrismaService } from "../prisma/prisma.service";
import { KnowledgeChunksRepository } from "./knowledge-chunks.repository";
import { KnowledgeVectorsService } from "./knowledge-vectors.service";

const INTERVAL_MS = 6 * 60 * 60 * 1000;
const STALE_LIFECYCLE_LEASE_MS = 30 * 60 * 1000;

/** Removes chunk/vector artifacts left by PostgreSQL workspace/user cascades, after confirming DB state. */
@Injectable()
export class KnowledgeDataReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunks: KnowledgeChunksRepository,
    private readonly vectors: KnowledgeVectorsService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async reconcile(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const [mongoArtifacts, vectorArtifacts] = await Promise.all([this.chunks.listArtifacts(), this.vectors.listArtifacts()]);
      const artifacts = [...mongoArtifacts, ...vectorArtifacts];
      const candidates = [...new Set(artifacts.map((artifact) => artifact.workspaceId))];
      if (!candidates.length) return 0;
      const liveRows = await this.prisma.workspace.findMany({ where: { id: { in: candidates } }, select: { id: true } });
      const liveIds = new Set(liveRows.map((row) => row.id));
      let removed = 0;
      for (const workspaceId of candidates) {
        if (liveIds.has(workspaceId)) continue;
        // The verified workspace ID is sourced from persisted artifact payloads, not user input.
        await this.vectors.deleteWorkspace(workspaceId);
        await this.chunks.deleteWorkspace(workspaceId);
        removed += 1;
      }
      if (liveIds.size) {
        const files = await this.prisma.knowledgeFile.findMany({
          where: { workspaceId: { in: [...liveIds] } },
          select: { id: true, workspaceId: true, status: true, activeGenerationId: true, processingAttemptId: true, updatedAt: true },
        });
        const fileByKey = new Map<string, typeof files[number]>(files.map((file) => [`${file.workspaceId}\0${file.id}`, file]));
        for (const [key, file] of fileByKey) {
          if (!file.processingAttemptId || !["PROCESSING", "EXTRACTED", "EMBEDDING_PENDING"].includes(file.status) ||
            Date.now() - file.updatedAt.getTime() < STALE_LIFECYCLE_LEASE_MS) continue;
          const recovered = await this.prisma.knowledgeFile.updateMany({
            where: {
              id: file.id, workspaceId: file.workspaceId, status: file.status,
              processingAttemptId: file.processingAttemptId, updatedAt: file.updatedAt,
            },
            data: file.activeGenerationId
              ? { status: "READY", processingAttemptId: null, failureReason: null }
              : { status: "FAILED", processingAttemptId: null, failureReason: "STALE_PROCESSING" },
          });
          if (recovered.count === 1) fileByKey.set(key, { ...file, status: file.activeGenerationId ? "READY" : "FAILED", processingAttemptId: null });
          else fileByKey.delete(key); // A live attempt changed the lease; leave its artifacts alone.
        }
        const generations = new Map<string, { workspaceId: string; fileId: string; generationId: string }>();
        for (const artifact of artifacts) generations.set(`${artifact.workspaceId}\0${artifact.fileId}\0${artifact.generationId}`, artifact);
        for (const artifact of generations.values()) {
          if (!liveIds.has(artifact.workspaceId)) continue;
          const file = fileByKey.get(`${artifact.workspaceId}\0${artifact.fileId}`);
          if (file?.status === "DELETING" && file.processingAttemptId && Date.now() - file.updatedAt.getTime() < STALE_LIFECYCLE_LEASE_MS) continue;
          if (file?.activeGenerationId === artifact.generationId || file?.processingAttemptId === artifact.generationId) continue;
          await this.vectors.deleteGeneration(artifact.workspaceId, artifact.fileId, artifact.generationId);
          await this.chunks.deleteGeneration(artifact.workspaceId, artifact.fileId, artifact.generationId);
          removed += 1;
        }
      }
      return removed;
    } catch (error) {
      // Never clean based on an unconfirmed Postgres/Mongo/Qdrant view; the next interval retries.
      this.logger.warn({ err: error }, "Knowledge artifact reconciliation failed");
      return 0;
    } finally {
      this.running = false;
    }
  }
}
