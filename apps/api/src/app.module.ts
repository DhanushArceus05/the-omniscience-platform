import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { HealthModule } from "./health/health.module";
import { MailModule } from "./mail/mail.module";
import { RedisModule } from "./redis/redis.module";

/**
 * Root module.
 *
 * Phase 0 — Foundation: HealthModule.
 * Phase 2 — Authentication & Users, Step 1 (configuration and
 * infrastructure setup): ConfigModule, RedisModule, MailModule. All
 * three are `@Global()`, so they're imported once here and available to
 * every feature module without re-importing.
 *
 * Prisma's *configuration* (`apps/api/prisma/schema.prisma`, datasource +
 * generator) is part of Step 1, but `PrismaService`/`PrismaModule` are
 * deliberately NOT wired here yet: `prisma generate` requires at least
 * one model to produce a client, and Step 1 intentionally defines no
 * models (those arrive in Step 2 with `User`). Wiring a PrismaService
 * that depends on an ungenerated `@prisma/client` would break install/
 * build/typecheck for everyone, so that wiring is deferred to Step 2.
 *
 * The Auth/Users feature module itself is also added in Step 2 onward.
 */
@Module({
  imports: [ConfigModule, RedisModule, MailModule, HealthModule],
})
export class AppModule {}
