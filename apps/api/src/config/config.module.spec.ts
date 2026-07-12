import { Test, TestingModule } from "@nestjs/testing";
import type { Logger } from "pino";
import { ConfigModule } from "./config.module";
import { ENV, LOGGER } from "./config.constants";

describe("ConfigModule", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      API_PORT: "4000",
      API_HOST: "0.0.0.0",
      API_CORS_ORIGIN: "http://localhost:5173",
      POSTGRES_URL: "postgresql://user:pass@localhost:5432/db",
      MONGO_URL: "mongodb://user:pass@localhost:27017/db",
      REDIS_URL: "redis://localhost:6379",
      QDRANT_URL: "http://localhost:6333",
      JWT_ACCESS_SECRET: "a".repeat(32),
      JWT_REFRESH_SECRET: "b".repeat(32),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("provides a validated ENV and a LOGGER derived from it", async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule],
    }).compile();

    const env = module.get(ENV);
    const logger = module.get<Logger>(LOGGER);

    expect(env.POSTGRES_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(typeof logger.info).toBe("function");
  });

  it("throws a descriptive error when the environment is invalid", async () => {
    delete process.env["POSTGRES_URL"];

    await expect(
      Test.createTestingModule({ imports: [ConfigModule] }).compile(),
    ).rejects.toThrow(/POSTGRES_URL/);
  });
});
