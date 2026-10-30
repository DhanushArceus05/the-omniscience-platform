/**
 * Phase 7 Step 1 — Knowledge file types.
 *
 * Request/response contracts for knowledge file management endpoints.
 * All operations are workspace-scoped and ownership-checked.
 */

export type KnowledgeFileStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "EXTRACTED"
  | "EMBEDDING_PENDING"
  | "READY"
  | "FAILED"
  | "DELETING";

export interface KnowledgeFile {
  id: string;
  workspaceId: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  status: KnowledgeFileStatus;
  chunkCount: number | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadKnowledgeFileResponse {
  file: KnowledgeFile;
}

export interface ListKnowledgeFilesResponse {
  files: KnowledgeFile[];
}

export interface GetKnowledgeFileResponse {
  file: KnowledgeFile;
}

export interface DeleteKnowledgeFileResponse {
  deleted: true;
}

/**
 * Phase 7 Step 3+ — Chunk metadata (deferred until chunking is implemented).
 * Defined here to establish the shape early, but not used in Step 1.
 */
export interface KnowledgeChunk {
  id: string;
  workspaceId: string;
  fileId: string;
  chunkIndex: number;
  text: string;
  tokenEstimate: number;
  pageMetadata?: number | null;
}

/**
 * Phase 7 Step 6+ — Retrieval results (deferred until retrieval is implemented).
 */
export interface KnowledgeQueryResult {
  chunk: KnowledgeChunk;
  score: number;
}

/**
 * Phase 7 Step 8+ — Citation metadata (deferred until citations are implemented).
 */
export interface Citation {
  fileId: string;
  fileName: string;
  chunkIndex: number;
  pageNumber?: number | null;
  score: number;
  excerpt: string;
}
