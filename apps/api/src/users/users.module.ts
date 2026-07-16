import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * User-profile module (Phase 2 Step 6, extended in Step 8).
 *
 * Imports `AuthModule` to reuse its exported `JwtAuthGuard` (route
 * protection), `PasswordHasherService` (via `UsersService`), and — as
 * of Step 8 — `RefreshTokenStore` (to revoke a deleted account's
 * sessions) rather than re-implementing any of them — same "one focused
 * service, reused everywhere it's needed" convention `AuthModule` itself
 * already follows. `PrismaService` is available here without an
 * explicit import since `PrismaModule` is `@Global()`.
 *
 * No session/refresh-token revocation on password *change* — same known
 * limitation already logged for Step 5's `resetPassword`, for the same
 * reason (unrelated to Step 8, which only wires revocation into
 * *account deletion*, a deliberately separate decision — see
 * `UsersService.deleteAccount`'s docstring).
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
