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
 */
@Module({
  imports: [AuthModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
})
export class WorkspacesModule {}
