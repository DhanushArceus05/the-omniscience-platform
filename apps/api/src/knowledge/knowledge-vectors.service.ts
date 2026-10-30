import { createHash } from "node:crypto";
import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { ENV } from "../config/config.constants";
import type { EmbeddedKnowledgeChunk } from "./knowledge-embedding.service";

const COLLECTION = "omniscience_knowledge";
const VECTOR_SIZE = 1536;
const UPSERT_BATCH_SIZE = 64;

interface VectorPoint {
  id: string;
  vector: readonly number[];
  payload: { workspaceId: string; fileId: string; generationId: string; chunkId: string; chunkIndex: number };
}

@Injectable()
export class KnowledgeVectorsService {
  private ready = false;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async ensureCollection(): Promise<void> {
    if (this.ready) return;
    const current = await this.request("GET", `/collections/${COLLECTION}`, undefined, true);
    if (current === null) {
      try {
        await this.request("PUT", `/collections/${COLLECTION}`, { vectors: { size: VECTOR_SIZE, distance: "Cosine" } });
      } catch {
        // Concurrent app instances may both observe 404; accept the race only
        // after rereading and validating the collection that now exists.
        const raced = await this.request("GET", `/collections/${COLLECTION}`, undefined, true);
        if (!hasExpectedVectorConfig(raced)) throw new ServiceUnavailableException({ code: "KNOWLEDGE_VECTOR_CONFIG_INVALID", message: "The vector index configuration is incompatible." });
      }
    } else if (!hasExpectedVectorConfig(current)) {
      throw new ServiceUnavailableException({ code: "KNOWLEDGE_VECTOR_CONFIG_INVALID", message: "The vector index configuration is incompatible." });
    }
    await this.createPayloadIndex("workspaceId", "keyword");
    await this.createPayloadIndex("fileId", "keyword");
    await this.createPayloadIndex("generationId", "keyword");
    await this.createPayloadIndex("chunkIndex", "integer");
    this.ready = true;
  }

  async indexFile(workspaceId: string, fileId: string, generationId: string, embeddings: readonly EmbeddedKnowledgeChunk[]): Promise<void> {
    await this.upsertBatch(workspaceId, fileId, generationId, embeddings);
    await this.reconcileGeneration(workspaceId, fileId, generationId, new Set(embeddings.map((item) => deterministicPointId(workspaceId, fileId, generationId, item.chunkIndex))));
  }

  async upsertBatch(workspaceId: string, fileId: string, generationId: string, embeddings: readonly EmbeddedKnowledgeChunk[]): Promise<void> {
    await this.ensureCollection();
    for (const embedded of embeddings) {
      if (embedded.workspaceId !== workspaceId || embedded.fileId !== fileId || embedded.generationId !== generationId || embedded.vector.length !== VECTOR_SIZE || embedded.vector.some((n) => !Number.isFinite(n))) {
        throw new ServiceUnavailableException({ code: "KNOWLEDGE_VECTOR_INVALID", message: "Vector data is invalid." });
      }
    }
    const points: VectorPoint[] = embeddings.map((item) => ({
      id: deterministicPointId(workspaceId, fileId, generationId, item.chunkIndex),
      vector: item.vector,
      payload: { workspaceId, fileId, generationId, chunkId: item.chunkId, chunkIndex: item.chunkIndex },
    }));
    for (let start = 0; start < points.length; start += UPSERT_BATCH_SIZE) {
      await this.request("PUT", `/collections/${COLLECTION}/points?wait=true`, { points: points.slice(start, start + UPSERT_BATCH_SIZE) });
    }
  }

  async reconcileGeneration(workspaceId: string, fileId: string, generationId: string, desiredPointIds: ReadonlySet<string>): Promise<void> {
    await this.ensureCollection();
    await this.deleteStalePoints(workspaceId, fileId, generationId, desiredPointIds);
  }

  async listGenerationIds(workspaceId: string, fileId: string): Promise<string[]> {
    await this.ensureCollection();
    const ids = new Set<string>();
    const seenOffsets = new Set<string>();
    let offset: unknown;
    do {
      const result = await this.request("POST", `/collections/${COLLECTION}/points/scroll`, {
        limit: 512, with_payload: ["generationId"], with_vector: false,
        ...(offset === undefined ? {} : { offset }),
        filter: { must: [{ key: "workspaceId", match: { value: workspaceId } }, { key: "fileId", match: { value: fileId } }] },
      });
      if (!isScrollResponse(result)) throw vectorUnavailable();
      for (const point of result.result.points) {
        if (typeof point.payload === "object" && point.payload !== null && "generationId" in point.payload && typeof point.payload.generationId === "string") ids.add(point.payload.generationId);
      }
      offset = result.result.next_page_offset;
      assertNewOffset(seenOffsets, offset);
    } while (offset !== null && offset !== undefined);
    return [...ids];
  }

  async deleteGeneration(workspaceId: string, fileId: string, generationId: string): Promise<void> {
    await this.ensureCollection();
    await this.request("POST", `/collections/${COLLECTION}/points/delete?wait=true`, {
      filter: { must: [
        { key: "workspaceId", match: { value: workspaceId } },
        { key: "fileId", match: { value: fileId } },
        { key: "generationId", match: { value: generationId } },
      ] },
    });
  }

  async deleteFile(workspaceId: string, fileId: string): Promise<void> {
    await this.ensureCollection();
    await this.request("POST", `/collections/${COLLECTION}/points/delete?wait=true`, {
      filter: { must: [{ key: "workspaceId", match: { value: workspaceId } }, { key: "fileId", match: { value: fileId } }] },
    });
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.ensureCollection();
    await this.request("POST", `/collections/${COLLECTION}/points/delete?wait=true`, {
      filter: { must: [{ key: "workspaceId", match: { value: workspaceId } }] },
    });
  }

  async listWorkspaceIds(): Promise<string[]> {
    await this.ensureCollection();
    const workspaceIds = new Set<string>();
    const seenOffsets = new Set<string>();
    let offset: unknown;
    do {
      const result = await this.request("POST", `/collections/${COLLECTION}/points/scroll`, {
        limit: 512,
        with_payload: ["workspaceId"],
        with_vector: false,
        ...(offset === undefined ? {} : { offset }),
      });
      if (!isScrollResponse(result)) throw vectorUnavailable();
      for (const point of result.result.points) {
        if (typeof point.payload === "object" && point.payload !== null && "workspaceId" in point.payload && typeof point.payload.workspaceId === "string") {
          workspaceIds.add(point.payload.workspaceId);
        }
      }
      offset = result.result.next_page_offset;
      assertNewOffset(seenOffsets, offset);
    } while (offset !== null && offset !== undefined);
    return [...workspaceIds];
  }

  async listArtifacts(): Promise<Array<{ workspaceId: string; fileId: string; generationId: string }>> {
    await this.ensureCollection();
    const artifacts: Array<{ workspaceId: string; fileId: string; generationId: string }> = [];
    const seenOffsets = new Set<string>();
    let offset: unknown;
    do {
      const result = await this.request("POST", `/collections/${COLLECTION}/points/scroll`, {
        limit: 512, with_payload: ["workspaceId", "fileId", "generationId"], with_vector: false,
        ...(offset === undefined ? {} : { offset }),
      });
      if (!isScrollResponse(result)) throw vectorUnavailable();
      for (const point of result.result.points) {
        const payload = point.payload;
        if (typeof payload === "object" && payload !== null && "workspaceId" in payload && typeof payload.workspaceId === "string" &&
          "fileId" in payload && typeof payload.fileId === "string" && "generationId" in payload && typeof payload.generationId === "string") {
          artifacts.push({ workspaceId: payload.workspaceId, fileId: payload.fileId, generationId: payload.generationId });
        }
      }
      offset = result.result.next_page_offset;
      assertNewOffset(seenOffsets, offset);
    } while (offset !== null && offset !== undefined);
    return artifacts;
  }

  private async deleteStalePoints(workspaceId: string, fileId: string, generationId: string, desired: ReadonlySet<string>): Promise<void> {
    let offset: unknown;
    const stale: string[] = [];
    const seenOffsets = new Set<string>();
    do {
      const result = await this.request("POST", `/collections/${COLLECTION}/points/scroll`, {
        limit: 256,
        with_payload: false,
        with_vector: false,
        ...(offset === undefined ? {} : { offset }),
        filter: { must: [
          { key: "workspaceId", match: { value: workspaceId } },
          { key: "fileId", match: { value: fileId } },
          { key: "generationId", match: { value: generationId } },
        ] },
      });
      if (!isScrollResponse(result)) throw vectorUnavailable();
      const page = result.result;
      for (const point of page.points) if (typeof point.id === "string" && !desired.has(point.id)) stale.push(point.id);
      offset = page.next_page_offset;
      assertNewOffset(seenOffsets, offset);
    } while (offset !== null && offset !== undefined);
    if (stale.length) await this.request("POST", `/collections/${COLLECTION}/points/delete?wait=true`, { points: stale });
  }

  private async createPayloadIndex(field: string, type: "keyword" | "integer"): Promise<void> {
    await this.request("PUT", `/collections/${COLLECTION}/index?wait=true`, { field_name: field, field_schema: type });
  }

  private async request(method: string, endpoint: string, body?: unknown, allowNotFound = false): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${this.env.QDRANT_URL.replace(/\/$/u, "")}${endpoint}`, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.env.AI_REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (attempt < 2) { await retryDelay(attempt); continue; }
        throw vectorUnavailable();
      }
      if (allowNotFound && response.status === 404) return null;
      if (!response.ok) {
        if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
          await retryDelay(attempt);
          continue;
        }
        throw vectorUnavailable();
      }
      if (response.status === 204) return {};
      try { return await response.json() as unknown; } catch { throw vectorUnavailable(); }
    }
    throw vectorUnavailable();
  }
}

export function deterministicPointId(workspaceId: string, fileId: string, generationId: string, chunkIndex: number): string {
  const bytes = createHash("sha256").update(`${workspaceId}\0${fileId}\0${generationId}\0${chunkIndex}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hasExpectedVectorConfig(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("result" in value)) return false;
  const result = value.result;
  if (typeof result !== "object" || result === null || !("config" in result)) return false;
  const config = result.config;
  if (typeof config !== "object" || config === null || !("params" in config)) return false;
  const params = config.params;
  if (typeof params !== "object" || params === null || !("vectors" in params)) return false;
  const vectors = params.vectors;
  return typeof vectors === "object" && vectors !== null && "size" in vectors && "distance" in vectors &&
    vectors.size === VECTOR_SIZE && vectors.distance === "Cosine";
}

function isScrollResponse(value: unknown): value is { result: { points: Array<{ id: unknown; payload?: unknown }>; next_page_offset?: unknown } } {
  if (typeof value !== "object" || value === null || !("result" in value)) return false;
  const result = value.result;
  return typeof result === "object" && result !== null && "points" in result && Array.isArray(result.points) &&
    "next_page_offset" in result;
}

function assertNewOffset(seen: Set<string>, offset: unknown): void {
  if (offset === null || offset === undefined) return;
  const key = JSON.stringify(offset);
  if (key === undefined) throw vectorUnavailable();
  if (seen.has(key)) throw vectorUnavailable();
  seen.add(key);
}

function vectorUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "KNOWLEDGE_VECTOR_STORE_UNAVAILABLE", message: "The document index is temporarily unavailable. Please retry processing." });
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
}
