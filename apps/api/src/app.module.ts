import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "./config/config.module";
import { HealthModule } from "./health/health.module";
import { MailModule } from "./mail/mail.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { UsersModule } from "./users/users.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

/**
 * Root module.
 *
 * Phase 0 — Foundation: HealthModule.
 * Phase 2 — Authentication & Users:
 *   Step 1: ConfigModule, RedisModule, MailModule (all `@Global()`).
 *   Step 2: PrismaModule restored now that the `User` model exists (see
 *     claude/CURRENT_PHASE.md, Step 1 fix); AuthModule added as a
 *     foundation (no endpoints yet at that point).
 *   Step 3: `ThrottlerModule` + a global `ThrottlerGuard` (per the
 *     approved Phase 2 decision to use `@nestjs/throttler`), protecting
 *     AuthModule's new `/auth/register`, `/auth/verify-otp`, and
 *     `/auth/resend-otp` endpoints. The default limit here (60
 *     requests/60s per IP) is a generic API-wide safety net; the auth
 *     endpoints themselves set tighter per-route limits via `@Throttle()`.
 *     Uses the default in-memory throttle storage (fine for a single
 *     instance; a shared Redis-backed store would be needed for
 *     horizontal scaling — see Step 3's known limitations).
 *   Step 6: `UsersModule` added — `PATCH /users/me` and
 *     `POST /users/me/change-password`, both behind the same global
 *     `ThrottlerGuard` plus their own per-route `@Throttle()` limits.
 * Phase 3 — Dashboard & Workspace:
 *   Step 2 (this step): `WorkspacesModule` added — `POST /workspaces`,
 *     `GET /workspaces`, `GET /workspaces/:id`, all behind
 *     `JwtAuthGuard` and scoped to the caller's own workspaces.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    MailModule,
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 60 }]),
    AuthModule,
    UsersModule,
    WorkspacesModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
