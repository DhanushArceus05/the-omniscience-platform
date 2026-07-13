import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "./config/config.module";
import { HealthModule } from "./health/health.module";
import { MailModule } from "./mail/mail.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";

/**
 * Root module.
 *
 * Phase 0 — Foundation: HealthModule.
 * Phase 2 — Authentication & Users:
 *   Step 1: ConfigModule, RedisModule, MailModule (all `@Global()`).
 *   Step 2: PrismaModule restored now that the `User` model exists and
 *     `prisma generate` can produce a real client (see
 *     claude/CURRENT_PHASE.md, Step 1 fix); AuthModule added as the
 *     foundation for registration/login in Step 3/4 — no endpoints are
 *     exposed by it yet.
 */
@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, MailModule, AuthModule, HealthModule],
})
export class AppModule {}
