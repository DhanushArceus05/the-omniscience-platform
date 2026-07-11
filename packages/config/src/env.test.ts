import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const validEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "info",
  API_PORT: "4000",
  API_HOST: "0.0.0.0",
  API_CORS_ORIGIN: "http://localhost:5173",
  POSTGRES_URL: "postgresql://user:pass@localhost:5432/db",
  MONGO_URL: "mongodb://user:pass@localhost:27017/db",
  REDIS_URL: "redis://localhost:6379",
  QDRANT_URL: "http://localhost:6333",
} as unknown as NodeJS.ProcessEnv;

describe("loadEnv", () => {
  it("parses a valid environment and coerces types", () => {
    const env = loadEnv(validEnv);
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("test");
  });

  it("applies defaults for optional variables", () => {
    const { LOG_LEVEL: _omit, ...rest } = validEnv as Record<string, string>;
    const env = loadEnv(rest as unknown as NodeJS.ProcessEnv);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("throws a descriptive error when a required variable is missing", () => {
    const { POSTGRES_URL: _omit, ...rest } = validEnv as Record<string, string>;
    expect(() => loadEnv(rest as unknown as NodeJS.ProcessEnv)).toThrowError(/POSTGRES_URL/);
  });

  it("throws when a numeric variable is malformed", () => {
    const broken = { ...validEnv, API_PORT: "not-a-number" } as unknown as NodeJS.ProcessEnv;
    expect(() => loadEnv(broken)).toThrow();
  });
});
