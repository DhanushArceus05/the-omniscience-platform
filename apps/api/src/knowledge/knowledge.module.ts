import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AiModule } from "../ai/ai.module";
import { DocumentExtractionService } from "./document-extraction.service";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeStorageService } from "./knowledge-storage.service";
import { KnowledgeStorageReconciliationService } from "./knowledge-storage-reconciliation.service";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeChunkingService } from "./knowledge-chunking.service";
import { KnowledgeChunksRepository } from "./knowledge-chunks.repository";
import { KnowledgeEmbeddingService } from "./knowledge-embedding.service";
import { KnowledgeVectorsService } from "./knowledge-vectors.service";
import { KnowledgeProcessingService } from "./knowledge-processing.service";
import { KnowledgeDataReconciliationService } from "./knowledge-data-reconciliation.service";
import { KnowledgeRetrievalService } from "./knowledge-retrieval.service";
import { KnowledgeContextService } from "./knowledge-context.service";
import { KnowledgeReadLeaseService } from "./knowledge-read-lease.service";

/**
 * Phase 7 Steps 1–5 — Knowledge storage, extraction, chunking, embedding,
 * vector indexing, and workspace-scoped processing orchestration.
 *
 * `@Global()` follows the same convention as `AvatarModule` —
 * `KnowledgeStorageService` and `DocumentExtractionService` will be
 * injectable anywhere without explicit imports. `KnowledgeProcessingService`
 * is still exposed only through the authenticated Knowledge controller.
 *
 * Imports `AuthModule` to reuse its exported `JwtAuthGuard` — same
 * convention `WorkspacesModule`, `UsersModule`, and `ConversationsModule`
 * already follow. `PrismaService` is available without an explicit import
 * since `PrismaModule` is `@Global()`.
 */
@Global()
@Module({
  imports: [AuthModule, WorkspacesModule, AiModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    KnowledgeStorageService,
    DocumentExtractionService,
    KnowledgeStorageReconciliationService,
    KnowledgeChunkingService,
    KnowledgeChunksRepository,
    KnowledgeEmbeddingService,
    KnowledgeVectorsService,
    KnowledgeProcessingService,
    KnowledgeDataReconciliationService,
    KnowledgeRetrievalService,
    KnowledgeContextService,
    KnowledgeReadLeaseService,
  ],
  exports: [KnowledgeService, KnowledgeStorageService, DocumentExtractionService, KnowledgeProcessingService, KnowledgeRetrievalService, KnowledgeContextService, KnowledgeReadLeaseService],
})
export class KnowledgeModule {}
