import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { Inject } from "@nestjs/common";
import { ENV } from "../config/config.constants";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { KnowledgeChunksRepository, type KnowledgeChunkDocument } from "./knowledge-chunks.repository";
import { KnowledgeEmbeddingService } from "./knowledge-embedding.service";
import { deterministicPointId, KnowledgeVectorsService, type KnowledgeVectorSearchHit } from "./knowledge-vectors.service";
import { KnowledgeReadLeaseService, type KnowledgeReadLease } from "./knowledge-read-lease.service";

export interface RetrievedKnowledgeSource {
  sourceId: string;
  workspaceId: string;
  fileId: string;
  fileName: string;
  generationId: string;
  chunkId: string;
  chunkIndex: number;
  text: string;
  score: number;
  pageNumbers?: number[];
}
export type RetrievedKnowledgeBundle = RetrievedKnowledgeSource[] & { sources: RetrievedKnowledgeSource[]; leases: KnowledgeReadLease[] };

const MAX_QUERY_LENGTH = 8000;
const MAX_QDRANT_RESULTS = 64;

@Injectable()
export class KnowledgeRetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly chunks: KnowledgeChunksRepository,
    private readonly embeddings: KnowledgeEmbeddingService,
    private readonly vectors: KnowledgeVectorsService,
    @Inject(ENV) private readonly env: Env,
    private readonly readLeases: KnowledgeReadLeaseService,
  ) {}

  async assertLeases(leases: readonly KnowledgeReadLease[]): Promise<void> {
    for (const lease of leases) await this.readLeases.assertValid(lease);
  }
  async renewLeases(leases: readonly KnowledgeReadLease[]): Promise<boolean> {
    for (const lease of leases) if (!(await this.readLeases.renew(lease))) return false;
    return true;
  }
  async releaseLeases(leases: readonly KnowledgeReadLease[]): Promise<void> { await this.readLeases.releaseMany(leases); }

  async retrieve(ownerId: string, workspaceId: string, query: string): Promise<RetrievedKnowledgeBundle> {
    if (!query.trim() || query.length > MAX_QUERY_LENGTH) {
      throw new ServiceUnavailableException({ code: "KNOWLEDGE_QUERY_INVALID", message: "Knowledge search could not be completed." });
    }
    await this.workspaces.getById(ownerId, workspaceId);
    const files = await this.findReadyFiles(ownerId, workspaceId);
    if (!files.length) return toBundle([], []);
    const activeFiles = new Map(files.map((file) => [file.id, { fileName: file.originalName, generationId: file.activeGenerationId }]));
    const vector = await this.embeddings.embedQuery(query);
    const configuredLimit = this.env.KNOWLEDGE_RETRIEVAL_LIMIT;
    const activeGenerationIds = files.map((file) => file.activeGenerationId).filter((id): id is string => typeof id === "string");
    if (!activeGenerationIds.length) return toBundle([], []);
    const hits = await this.vectors.search(workspaceId, vector, Math.min(MAX_QDRANT_RESULTS, configuredLimit * 4), activeGenerationIds);
    const accepted = hits
      .filter((hit) => hit.payload.workspaceId === workspaceId &&
        hit.id === deterministicPointId(workspaceId, hit.payload.fileId, hit.payload.generationId, hit.payload.chunkIndex) &&
        hit.score >= this.env.KNOWLEDGE_RETRIEVAL_MIN_SCORE &&
        activeFiles.get(hit.payload.fileId)?.generationId === hit.payload.generationId)
      .sort(compareHits);
    const seenChunks = new Set<string>();
    const selected: KnowledgeVectorSearchHit[] = [];
    for (const hit of accepted) {
      const { chunkId } = hit.payload;
      if (seenChunks.has(chunkId)) continue;
      seenChunks.add(chunkId);
      selected.push(hit);
    }

    const byGeneration = new Map<string, KnowledgeVectorSearchHit[]>();
    for (const hit of selected) {
      const key = `${hit.payload.fileId}\0${hit.payload.generationId}`;
      const items = byGeneration.get(key) ?? [];
      items.push(hit);
      byGeneration.set(key, items);
    }
    const sources: RetrievedKnowledgeSource[] = [];
    const leases: KnowledgeReadLease[] = [];
    for (const group of byGeneration.values()) {
      const first = group[0];
      if (!first) continue;
      const file = activeFiles.get(first.payload.fileId);
      if (!file) continue;
      let lease: KnowledgeReadLease | null;
      try {
        lease = await this.readLeases.acquire(ownerId, workspaceId, first.payload.fileId, first.payload.generationId);
      } catch {
        await this.readLeases.releaseMany(leases).catch(() => undefined);
        throw retrievalUnavailable();
      }
      if (!lease) continue;
      leases.push(lease);
      let documents: KnowledgeChunkDocument[];
      try {
        documents = await this.chunks.listByIds(workspaceId, first.payload.fileId, first.payload.generationId, group.map((item) => item.payload.chunkId));
      } catch {
        await this.readLeases.releaseMany(leases).catch(() => undefined);
        throw retrievalUnavailable();
      }
      try {
        const byId = new Map(documents.map((document) => [document._id, document]));
        for (const hit of group) {
          const document = byId.get(hit.payload.chunkId);
          if (!document || document.workspaceId !== workspaceId || document.fileId !== hit.payload.fileId ||
            document.generationId !== hit.payload.generationId || document.chunkIndex !== hit.payload.chunkIndex) continue;
          sources.push(toSource(document, file.fileName, hit.score));
        }
      } catch (error) {
        await this.readLeases.releaseMany(leases).catch(() => undefined);
        throw error;
      }
    }
    try {
      for (const lease of leases) await this.readLeases.assertValid(lease);
      const fileCounts = new Map<string, number>();
      const limited = sources.sort((a, b) => b.score - a.score || a.fileId.localeCompare(b.fileId) || a.chunkIndex - b.chunkIndex)
        .filter((source) => {
          const count = fileCounts.get(source.fileId) ?? 0;
          if (count >= this.env.KNOWLEDGE_RETRIEVAL_PER_FILE_LIMIT) return false;
          fileCounts.set(source.fileId, count + 1);
          return true;
        }).slice(0, configuredLimit);
      const needed = new Set(limited.map((source) => source.fileId));
      const retained = leases.filter((lease) => needed.has(lease.fileId));
      await this.readLeases.releaseMany(leases.filter((lease) => !needed.has(lease.fileId)));
      return toBundle(limited, retained);
    } catch (error) {
      await this.readLeases.releaseMany(leases).catch(() => undefined);
      throw error;
    }
  }

  /** Revalidates source authority immediately before citation persistence. */
  async validateSources(ownerId: string, workspaceId: string, sources: readonly RetrievedKnowledgeSource[]): Promise<RetrievedKnowledgeSource[]> {
    if (!sources.length) return [];
    await this.workspaces.getById(ownerId, workspaceId);
    const fileIds = [...new Set(sources.map((source) => source.fileId))];
    const files = await this.findReadyFiles(ownerId, workspaceId, fileIds);
    const active = new Map(files.map((file) => [file.id, { name: file.originalName, generationId: file.activeGenerationId }]));
    const validated: RetrievedKnowledgeSource[] = [];
    for (const source of sources) {
      const file = active.get(source.fileId);
      if (!file || file.generationId !== source.generationId) continue;
      const rows: KnowledgeChunkDocument[] = await this.chunks.listByIds(workspaceId, source.fileId, source.generationId, [source.chunkId]);
      const chunk = rows.find((row) => row._id === source.chunkId && row.chunkIndex === source.chunkIndex);
      if (chunk) validated.push(toSource(chunk, file.name, source.score));
    }
    return validated;
  }

  private async findReadyFiles(ownerId: string, workspaceId: string, fileIds?: string[]) {
    try {
      return await this.prisma.knowledgeFile.findMany({
        where: {
          ownerId, workspaceId, status: "READY", activeGenerationId: { not: null },
          ...(fileIds ? { id: { in: fileIds } } : {}),
        },
        select: { id: true, originalName: true, activeGenerationId: true },
      });
    } catch {
      throw retrievalUnavailable();
    }
  }
}

function toSource(document: KnowledgeChunkDocument, fileName: string, score: number): RetrievedKnowledgeSource {
  if (!Number.isFinite(score) || !Number.isInteger(document.chunkIndex) || !document.text) {
    throw new ServiceUnavailableException({ code: "KNOWLEDGE_RETRIEVAL_RESPONSE_INVALID", message: "Knowledge search returned invalid data." });
  }
  return {
    sourceId: `S-${document._id.slice(0, 16)}`,
    workspaceId: document.workspaceId,
    fileId: document.fileId,
    fileName,
    generationId: document.generationId,
    chunkId: document._id,
    chunkIndex: document.chunkIndex,
    text: document.text,
    score,
    ...(Array.isArray(document.pageNumbers) && document.pageNumbers.every(Number.isInteger) ? { pageNumbers: document.pageNumbers } : {}),
  };
}

function compareHits(a: KnowledgeVectorSearchHit, b: KnowledgeVectorSearchHit): number {
  return b.score - a.score || a.payload.fileId.localeCompare(b.payload.fileId) || a.payload.chunkIndex - b.payload.chunkIndex;
}

function retrievalUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "KNOWLEDGE_RETRIEVAL_UNAVAILABLE", message: "Knowledge search is temporarily unavailable. Please retry." });
}

function toBundle(sources: RetrievedKnowledgeSource[], leases: KnowledgeReadLease[]): RetrievedKnowledgeBundle {
  Object.defineProperties(sources, {
    sources: { value: sources, enumerable: false },
    leases: { value: leases, enumerable: false },
  });
  return sources as RetrievedKnowledgeBundle;
}
