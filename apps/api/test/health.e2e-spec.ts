import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import type Redis from "ioredis";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { ENV } from "../src/config/config.constants";
import { RedisService } from "../src/redis/redis.service";

/**
 * This is a health-endpoint smoke test only. It boots the real
 * `AppModule` (so it still exercises the actual wiring: ConfigModule,
 * RedisModule, MailModule, HealthModule), but it must not require a real
 * Postgres/Redis/Mongo/Qdrant instance or real secrets to run in CI/local
 * `pnpm test`.
 *
 * `packages/config`'s environment validation is NOT weakened or bypassed:
 * `ENV` is overridden with a fully valid, correctly-shaped test `Env`
 * object (same schema, same required fields, just test values) rather
 * than making any variable optional.
 *
 * `RedisService` is the only provider in `AppModule` that opens a real
 * network connection during `onModuleInit` (there is no Prisma wiring
 * yet — see claude/CURRENT_PHASE.md Step 1). It's overridden with a
 * no-op stub so this suite never dials an actual Redis server. This does
 * not change application behavior: production still uses the real
 * `RedisService` untouched — only this test's DI container substitutes it.
 */
const testEnv: Env = {
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
};

class FakeRedisService {
  async onModuleInit(): Promise<void> {
    // no-op: this e2e suite is a health-only smoke test and must not
    // require a real Redis instance to be running.
  }

  onModuleDestroy(): void {
    // no-op
  }

  getClient(): Redis {
    return {} as unknown as Redis;
  }
}

describe("AppModule (e2e)", () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ENV)
      .useValue(testEnv)
      .overrideProvider(RedisService)
      .useValue(new FakeRedisService())
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(createLogger({ service: "api-test" })));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("GET /health returns 200 with status ok", async () => {
    const response = await request(app?.getHttpServer()).get("/health").expect(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.service).toBe("api");
  });

  it("GET /unknown-route returns a 404 ApiError envelope", async () => {
    const response = await request(app?.getHttpServer()).get("/unknown-route").expect(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBeDefined();
  });
});
