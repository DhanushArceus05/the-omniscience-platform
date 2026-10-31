import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { ENV } from "../config/config.constants";
import { ProviderRegistryService } from "../ai/provider-registry.service";
import { chunkDocumentId, type KnowledgeChunkDocument } from "./knowledge-chunks.repository";

export const KNOWLEDGE_EMBEDDING_MODEL = "text-embedding-3-small";
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536;
const MAX_TRANSIENT_ATTEMPTS = 3;

export interface EmbeddedKnowledgeChunk {
  workspaceId: string;
  fileId: string;
  chunkId: string;
  generationId: string;
  chunkIndex: number;
  vector: readonly number[];
}

@Injectable()
export class KnowledgeEmbeddingService {
  constructor(private readonly providers: ProviderRegistryService, @Inject(ENV) private readonly env: Env) {}

  async embedQuery(query: string): Promise<readonly number[]> {
    const provider = this.providers.getById("openai");
    let vector: readonly number[];
    let attempt = 0;
    for (;;) {
      try {
        vector = await provider.embed(KNOWLEDGE_EMBEDDING_MODEL, query);
        break;
      } catch (error) {
        if (!isTransientProviderError(error) || ++attempt >= MAX_TRANSIENT_ATTEMPTS) {
          throw new ServiceUnavailableException({
            code: "KNOWLEDGE_QUERY_EMBEDDING_FAILED",
            message: "Knowledge search is temporarily unavailable. Please retry.",
          });
        }
        await delay(100 * 2 ** (attempt - 1));
      }
    }
    if (vector.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
      throw invalidResponse();
    }
    return vector;
  }

  async embed(chunks: readonly KnowledgeChunkDocument[]): Promise<EmbeddedKnowledgeChunk[]> {
    const output: EmbeddedKnowledgeChunk[] = [];
    for await (const batch of this.embedBatches(chunks)) output.push(...batch);
    return output;
  }

  async *embedBatches(chunks: readonly KnowledgeChunkDocument[]): AsyncGenerator<EmbeddedKnowledgeChunk[]> {
    if (!chunks.length) return;
    const provider = this.providers.getById("openai");
    const batchSize = this.env.KNOWLEDGE_EMBEDDING_BATCH_SIZE;
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = chunks.slice(start, start + batchSize);
      const inputs = batch.map((chunk) => chunk.text);
      let indexed: readonly { index: number; embedding: readonly number[] }[];
      let attempt = 0;
      for (;;) {
        try {
          indexed = provider.embedBatch
            ? await provider.embedBatch(KNOWLEDGE_EMBEDDING_MODEL, inputs)
            : await Promise.all(inputs.map(async (text, index) => ({
                index,
                embedding: await provider.embed(KNOWLEDGE_EMBEDDING_MODEL, text),
              })));
          break;
        } catch (error) {
          if (!isTransientProviderError(error) || ++attempt >= MAX_TRANSIENT_ATTEMPTS) {
            throw new ServiceUnavailableException({
              code: "KNOWLEDGE_EMBEDDING_FAILED",
              message: "Document embeddings could not be generated. Please retry processing.",
            });
          }
          await delay(100 * 2 ** (attempt - 1));
        }
      }

      if (indexed.length !== batch.length) throw invalidResponse();
      const byIndex = new Map<number, readonly number[]>();
      for (const entry of indexed) {
        if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= batch.length || byIndex.has(entry.index) ||
          entry.embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS || entry.embedding.some((value) => !Number.isFinite(value))) {
          throw invalidResponse();
        }
        byIndex.set(entry.index, entry.embedding);
      }
      const output = batch.map((chunk, index) => {
        const vector = byIndex.get(index);
        if (!vector) throw invalidResponse();
        return {
          workspaceId: chunk.workspaceId,
          fileId: chunk.fileId,
          chunkId: chunkDocumentId(chunk.workspaceId, chunk.fileId, chunk.generationId, chunk.chunkIndex),
          generationId: chunk.generationId,
          chunkIndex: chunk.chunkIndex,
          vector,
        };
      });
      yield output;
    }
  }
}

function isTransientProviderError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("getStatus" in error) || typeof error.getStatus !== "function") return false;
  return [408, 429, 500, 502, 503, 504].includes(error.getStatus());
}

function invalidResponse(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "KNOWLEDGE_EMBEDDING_RESPONSE_INVALID", message: "The embedding provider returned invalid data." });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
