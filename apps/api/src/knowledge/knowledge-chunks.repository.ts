import { createHash } from "node:crypto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import { MongoService } from "../mongo/mongo.service";
import type { KnowledgeChunk } from "./knowledge-chunking.service";

export interface KnowledgeChunkDocument extends KnowledgeChunk {
  _id: string;
  workspaceId: string;
  fileId: string;
  generationId: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class KnowledgeChunksRepository implements OnModuleInit {
  constructor(private readonly mongo: MongoService) {}

  private get chunks(): Collection<KnowledgeChunkDocument> {
    return this.mongo.getDb().collection<KnowledgeChunkDocument>("knowledge_chunks");
  }

  async onModuleInit(): Promise<void> {
    await this.chunks.createIndex({ workspaceId: 1, fileId: 1, generationId: 1, chunkIndex: 1 }, {
      name: "knowledge_workspace_file_generation_chunk_unique",
      unique: true,
    });
    // Upgrade the earlier Step 3 uniqueness rule only after the generation-
    // scoped constraint is active. Retain all documents; the old index would
    // otherwise reject valid parallel generations at the same chunk index.
    const priorIndex = (await this.chunks.listIndexes().toArray()).find((index) =>
      index.name === "knowledge_workspace_file_chunk_unique" && index.unique === true &&
      index.key.workspaceId === 1 && index.key.fileId === 1 && index.key.chunkIndex === 1 && Object.keys(index.key).length === 3,
    );
    if (priorIndex?.name) await this.chunks.dropIndex(priorIndex.name);
    await this.chunks.createIndex({ workspaceId: 1 }, { name: "knowledge_workspace_chunks" });
  }

  /** Idempotently replaces a file's complete chunk set; deterministic ids and scoped stale cleanup make retries safe. */
  async replace(workspaceId: string, fileId: string, generationId: string, chunks: readonly KnowledgeChunk[]): Promise<KnowledgeChunkDocument[]> {
    const now = new Date();
    const documents = chunks.map((chunk) => ({
      ...chunk,
      _id: chunkDocumentId(workspaceId, fileId, generationId, chunk.chunkIndex),
      workspaceId,
      fileId,
      generationId,
      createdAt: now,
      updatedAt: now,
    }));
    if (documents.length) {
      await this.chunks.bulkWrite(documents.map((document) => ({
        updateOne: {
          filter: { workspaceId, fileId, generationId, chunkIndex: document.chunkIndex },
          update: {
            $set: {
              text: document.text,
              wordCount: document.wordCount,
              tokenEstimate: document.tokenEstimate,
              ...(document.pageNumbers ? { pageNumbers: document.pageNumbers } : {}),
              updatedAt: now,
            },
            $setOnInsert: { _id: document._id, createdAt: now },
            ...(!document.pageNumbers ? { $unset: { pageNumbers: "" } } : {}),
          },
          upsert: true,
        },
      })), { ordered: true });
      await this.chunks.deleteMany({ workspaceId, fileId, generationId, chunkIndex: { $nin: documents.map((item) => item.chunkIndex) } });
    } else {
      await this.chunks.deleteMany({ workspaceId, fileId, generationId });
    }
    return this.list(workspaceId, fileId, generationId);
  }

  list(workspaceId: string, fileId: string, generationId: string): Promise<KnowledgeChunkDocument[]> {
    return this.chunks.find({ workspaceId, fileId, generationId }).sort({ chunkIndex: 1 }).toArray();
  }

  listByIds(workspaceId: string, fileId: string, generationId: string, chunkIds: readonly string[]): Promise<KnowledgeChunkDocument[]> {
    if (!chunkIds.length) return Promise.resolve([]);
    return this.chunks.find({ _id: { $in: [...new Set(chunkIds)] }, workspaceId, fileId, generationId }).sort({ chunkIndex: 1 }).toArray();
  }

  async listGenerationIds(workspaceId: string, fileId: string): Promise<string[]> {
    return await this.chunks.distinct("generationId", { workspaceId, fileId }) as string[];
  }

  async listArtifacts(): Promise<Array<{ workspaceId: string; fileId: string; generationId: string }>> {
    return this.chunks.find({ generationId: { $type: "string" } }, {
      projection: { _id: 0, workspaceId: 1, fileId: 1, generationId: 1 },
    }).toArray() as Promise<Array<{ workspaceId: string; fileId: string; generationId: string }>>;
  }

  async deleteGeneration(workspaceId: string, fileId: string, generationId: string): Promise<void> {
    await this.chunks.deleteMany({ workspaceId, fileId, generationId });
  }

  async deleteFile(workspaceId: string, fileId: string): Promise<void> {
    await this.chunks.deleteMany({ workspaceId, fileId });
  }

  listWorkspaceIds(): Promise<unknown[]> {
    return this.chunks.distinct("workspaceId");
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.chunks.deleteMany({ workspaceId });
  }
}

export function chunkDocumentId(workspaceId: string, fileId: string, generationId: string, chunkIndex: number): string {
  return createHash("sha256").update(`${workspaceId}\0${fileId}\0${generationId}\0${chunkIndex}`).digest("hex");
}
