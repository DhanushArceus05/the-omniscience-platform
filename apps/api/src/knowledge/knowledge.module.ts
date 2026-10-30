import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DocumentExtractionService } from "./document-extraction.service";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeStorageService } from "./knowledge-storage.service";
import { KnowledgeStorageReconciliationService } from "./knowledge-storage-reconciliation.service";
import { KnowledgeService } from "./knowledge.service";

/**
 * Phase 7 Step 1 & Step 2 — knowledge file management module.
 *
 * `@Global()` follows the same convention as `AvatarModule` —
 * `KnowledgeStorageService` and `DocumentExtractionService` will be
 * injectable anywhere without explicit imports once later steps
 * (chunking, embedding) need them.
 *
 * Imports `AuthModule` to reuse its exported `JwtAuthGuard` — same
 * convention `WorkspacesModule`, `UsersModule`, and `ConversationsModule`
 * already follow. `PrismaService` is available without an explicit import
 * since `PrismaModule` is `@Global()`.
 */
@Global()
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeStorageService, DocumentExtractionService, KnowledgeStorageReconciliationService],
  exports: [KnowledgeService, KnowledgeStorageService, DocumentExtractionService],
})
export class KnowledgeModule {}
