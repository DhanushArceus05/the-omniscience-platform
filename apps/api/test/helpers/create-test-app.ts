import * as os from "node:os";
import * as path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Env } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ENV } from "../../src/config/config.constants";
import { MailService } from "../../src/mail/mail.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { RedisService } from "../../src/redis/redis.service";
import { FakeMailService } from "./fake-mail.service";
import { FakePrismaService } from "./fake-prisma.service";
import { FakeRedisService } from "./fake-redis.service";

/** Shared across every e2e spec so `JWT_ACCESS_SECRET` etc. never drift file-to-file. */
export const testEnv: Env = {
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  API_PORT: 4000,
  API_HOST: "0.0.0.0",
  API_CORS_ORIGIN: "http://localhost:5173",
  POSTGRES_URL: "postgresql://test:test@localhost:5432/test",
  MONGO_URL: "mongodb://test:test@localhost:27017/test",
  REDIS_URL: "redis://localhost:6379",
  QDRANT_URL: "http://localhost:6333",
  JWT_ACCESS_SECRET: "e2e-test-access-secret-0123456789ab",
  JWT_REFRESH_SECRET: "e2e-test-refresh-secret-0123456789a",
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 604800,
  SMTP_SECURE: false,
  OTP_TTL_SECONDS: 600,
  OTP_MAX_ATTEMPTS: 5,
  OTP_RESEND_COOLDOWN_SECONDS: 60,
  // Phase 3 Step 3 — `AvatarStorageService` is a real (never faked)
  // global provider: it's plain local-disk I/O, deterministic and fast
  // enough to run for real in every e2e spec, same as
  // `AccessTokenService`'s real JWT signing already does. Points at a
  // dedicated OS temp directory so a test run never touches
  // `AVATAR_STORAGE_DIR`'s real default/production location.
  AVATAR_STORAGE_DIR: path.join(os.tmpdir(), "omniscience-api-e2e-avatars"),
  AVATAR_PUBLIC_BASE_URL: "http://localhost:4000",
  AVATAR_MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
};

/**
 * Builds one fresh, fully-wired `INestApplication` from the real
 * `AppModule` — the real controllers, services, guards (including the
 * real `ThrottlerGuard`, never overridden), and validation pipes — with
 * only `ENV`/`RedisService`/`PrismaService`/`MailService` swapped for
 * fakes so a suite needs no live Postgres, Redis, or SMTP server.
 *
 * Every call compiles a brand-new `TestingModule`, which means a
 * brand-new DI container and therefore a brand-new (empty) in-memory
 * `ThrottlerStorageService` — a fresh per-IP rate-limit counter starting
 * at zero. This is the actual test-isolation mechanism every e2e spec in
 * this repo relies on: `ThrottlerGuard` is never overridden, stubbed, or
 * bypassed anywhere — production throttling runs for real on every
 * request every test makes — so isolation instead comes from giving a
 * test (or a small group of related, sequential tests) its own app and
 * therefore its own zeroed-out throttle counters. See
 * `test/auth-registration.e2e-spec.ts`'s class-level doc comment for the
 * fuller story of why its Step 3/4 tests share one app across the whole
 * describe block while its Step 5 tests each get their own.
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
  mail: FakeMailService;
}> {
  const mail = new FakeMailService();
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ENV)
    .useValue(testEnv)
    .overrideProvider(RedisService)
    .useValue(new FakeRedisService())
    .overrideProvider(PrismaService)
    .useValue(new FakePrismaService())
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.useGlobalFilters(new AllExceptionsFilter(createLogger({ service: "api-test" })));
  // Phase 3 Step 3 — mirrors `main.ts`'s real bootstrap exactly, so
  // `avatar.e2e-spec.ts` can assert an uploaded avatar is actually
  // reachable at the URL the API returns, not just that a URL-shaped
  // string came back.
  app.useStaticAssets(path.resolve(testEnv.AVATAR_STORAGE_DIR), { prefix: "/uploads/avatars" });
  await app.init();

  return { app, mail };
}
