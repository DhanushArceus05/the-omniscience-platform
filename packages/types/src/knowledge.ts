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

export interface KnowledgeQueryResult {
  chunk: KnowledgeChunk;
  score: number;
}

/** New values describe reference state, never semantic entailment. Legacy values remain readable from old persisted messages. */
export type KnowledgeGrounding = "NO_KNOWLEDGE" | "NOT_GROUNDED" | "SOURCE_REFERENCED" | "RETRIEVAL_UNAVAILABLE" | "GROUNDED" | "PARTIALLY_GROUNDED";

export interface Citation {
  id: string;
  sourceId: string;
  fileId: string;
  fileName: string;
  chunkId: string;
  chunkIndex: number;
  pageNumbers?: number[];
  retrievalScore: number;
  excerpt: string;
  /** The excerpt is a server-selected general excerpt, not a verified quotation or proof of claim support. */
  excerptKind?: "GENERAL_SOURCE_EXCERPT";
}

export interface KnowledgeMessageAttribution {
  grounding: KnowledgeGrounding;
  citations: Citation[];
}
