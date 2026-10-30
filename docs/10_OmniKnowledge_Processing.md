# OmniKnowledge Processing (Phase 7 Steps 3–5)

## Processing boundary

Knowledge upload remains a storage-only operation and creates a file in `UPLOADED`. An authenticated caller explicitly starts or retries processing with `POST /workspaces/:workspaceId/knowledge/:fileId/process`. The route resolves the workspace from the authenticated owner and returns only after processing has either completed or failed. Retrieval, chat/RAG integration, and search are outside this milestone.

## Pipeline and storage

1. `DocumentExtractionService` extracts PDF/DOCX/TXT text.
2. `KnowledgeChunkingService` splits on whitespace into 250-word chunks with a 50-word overlap (stride 200). Chunk text joins the source words with one space. Empty input produces zero chunks. PDF chunks include the distinct source `pageNumbers` represented in that chunk; other formats do not receive invented page metadata.
3. `KnowledgeChunksRepository` writes a staging generation in MongoDB. Its unique `{ workspaceId, fileId, generationId, chunkIndex }` index and deterministic generation-scoped document IDs make retries idempotent without overwriting the currently published generation. Startup creates the new index before removing the exact obsolete pre-generation unique index; no chunk documents are deleted by this index upgrade.
4. `KnowledgeEmbeddingService` uses the registered OpenAI `OmniProvider` and `text-embedding-3-small` in bounded batches (`KNOWLEDGE_EMBEDDING_BATCH_SIZE`, default 32, maximum 128). Every response index and 1536 finite vector coordinates are validated. `tokenEstimate` is `ceil(wordCount × 1.33)`, a heuristic rather than a tokenizer result.
5. `KnowledgeVectorsService` idempotently creates/validates the single `omniscience_knowledge` Qdrant collection (1536 dimensions, Cosine) and its workspace/file/generation/index payload indexes. Deterministic UUID point IDs include the generation. New-generation vectors are indexed without overwriting the active generation.
6. PostgreSQL atomically switches `activeGenerationId` and publishes `READY` only after MongoDB persistence, embedding, Qdrant indexing, and generation reconciliation succeed; `chunkCount` is switched with the generation.

## Status and recovery

The visible successful progression is `UPLOADED → PROCESSING → EXTRACTED → EMBEDDING_PENDING → READY`. Every processing claim receives an unpredictable UUID fencing token stored in `processingAttemptId`; all state transitions and guarded writes require that token. A replacement attempt fences the prior worker, which cannot publish or record failure for the new attempt. The processing token is also the staging `generationId`. Failed first processing records a fixed stage code; failed reprocessing retains the previous `activeGenerationId` and returns the file to `READY`. The explicit process route can retry failed files. A processing lease can be reclaimed after 30 minutes without a heartbeat.

Mongo and Qdrant writes are scoped to workspace, file, and generation. Each bounded persistence operation holds a PostgreSQL row lock while checking the current fencing token; a deletion claim takes the same row lock and moves the file to `DELETING`, so cleanup waits behind an in-flight write and prevents later writes. Provider calls do not hold a database transaction; the token is checked after each provider batch and before persistence. Reprocessing leaves the published generation untouched until an atomic PostgreSQL pointer switch. Failed/inactive generations are cleaned immediately when possible and retried by periodic reconciliation. A stale processing lease is conditionally fenced by reconciliation or the next processing claim; the old generation is then inactive and safe to clean. A crash can leave staging artifacts, but cannot publish them; subsequent retries and reconciliation are idempotent.

File deletion first claims `DELETING` with a distinct lifecycle token, then clears workspace/file-scoped Qdrant and MongoDB generations and the local source, and deletes the PostgreSQL row last. A failed cleanup releases the deletion token but retains `DELETING` metadata so an authorized retry can safely resume; processing cannot restart while deletion is pending. Workspace/user deletion continues to use existing PostgreSQL cascades. A six-hour reconciliation pass confirms workspace/file state in PostgreSQL before removing orphaned workspaces or inactive generations. Local source files continue to use the Step 1 storage reconciliation/grace period.

**Step 6 retrieval contract:** every retrieval query must derive workspace scope server-side, require `KnowledgeFile.status = READY`, and filter Qdrant/Mongo data by that file's exact `activeGenerationId`. Staging, failed, deleting, or inactive generations must never be returned. Step 6 is not implemented here.

## Operational limits

- OpenAI credentials are optional at API startup; processing fails safely until `OPENAI_API_KEY` is configured.
- MongoDB and Qdrant must be reachable for processing. Qdrant collection initialization is idempotent; an unavailable vector store does not make a KnowledgeFile `READY`.
- Processing runs synchronously in the authenticated request. There is no durable queue or automatic retry scheduler for failed files; a caller must retry through the process route. Per-call provider/Qdrant timeouts and the 30-minute processing lease bound individual waits, but there is no aggregate request deadline or document/chunk-count cap; large files may exceed proxy timeouts and may need a future worker/queue before production deployment.
- No arbitrary client-defined Qdrant filters or vector search endpoint are exposed.
