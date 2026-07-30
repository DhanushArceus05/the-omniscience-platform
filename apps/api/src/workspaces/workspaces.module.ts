import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

/**
 * Workspace module (Phase 3 Step 2). Imports `AuthModule` to reuse its
 * exported `JwtAuthGuard` — same "one focused guard, reused everywhere
 * it's needed" convention `UsersModule` (Phase 2 Step 6) already
 * follows. `PrismaService` is available here without an explicit import
 * since `PrismaModule` is `@Global()`.
 *
 * `WorkspacesService` is exported (Phase 6 Step 1) so
 * `ConversationsModule` can reuse its `getById()` ownership check
 * directly via dependency injection, rather than re-implementing
 * workspace ownership verification a second time — the same
 * "export the one reusable service" reasoning `AuthModule`'s and
 * `OmniCoreModule`'s exports already follow.
 */
@Module({
  imports: [AuthModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
