import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OmniCoreModule } from "../omnicore/omnicore.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ConversationsController } from "./conversations.controller";
import { ConversationsRepository } from "./conversations.repository";
import { ConversationsService } from "./conversations.service";

/**
 * Phase 6 Step 1 (Conversation & Message Persistence Foundation).
 * Imports `AuthModule` to reuse its exported `JwtAuthGuard` (same
 * convention `WorkspacesModule`/`OmniCoreModule` already follow),
 * `WorkspacesModule` to reuse its exported `WorkspacesService` for
 * ownership checks, and `OmniCoreModule` to reuse its exported
 * `OmniCoreService` — calling `execute()` directly via dependency
 * injection, never through the HTTP boundary.
 *
 * `MongoModule` is not imported here: it's `@Global()` (see
 * `../mongo/mongo.module.ts`), the same reasoning `PrismaModule`/
 * `RedisModule` already follow for not needing to be re-imported by
 * every feature module that needs them.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, OmniCoreModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsRepository],
})
export class ConversationsModule {}
