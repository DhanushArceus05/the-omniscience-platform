import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * User-profile module (Phase 2 Step 6).
 *
 * Imports `AuthModule` to reuse its exported `JwtAuthGuard` (route
 * protection) and `PasswordHasherService` (via `UsersService`) rather
 * than re-implementing either — same "one focused service, reused
 * everywhere it's needed" convention `AuthModule` itself already
 * follows. `PrismaService` is available here without an explicit import
 * since `PrismaModule` is `@Global()`.
 *
 * No session/refresh-token revocation on password change — same known
 * limitation already logged for Step 5's `resetPassword`, for the same
 * reason: `RefreshTokenStore` has no per-user index to revoke from.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
