import { describe, expect, it } from "vitest";
import { isSmtpConfigured, loadEnv } from "./env";

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
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
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

  describe("Phase 2 — JWT", () => {
    it("applies the approved default TTLs (15m access / 7d refresh) when unset", () => {
      const env = loadEnv(validEnv);
      expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
      expect(env.JWT_REFRESH_TTL_SECONDS).toBe(604800);
    });

    it("allows overriding the TTL defaults", () => {
      const env = loadEnv({
        ...validEnv,
        JWT_ACCESS_TTL_SECONDS: "60",
        JWT_REFRESH_TTL_SECONDS: "3600",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.JWT_ACCESS_TTL_SECONDS).toBe(60);
      expect(env.JWT_REFRESH_TTL_SECONDS).toBe(3600);
    });

    it("throws a descriptive error when JWT_ACCESS_SECRET is missing", () => {
      const { JWT_ACCESS_SECRET: _omit, ...rest } = validEnv as Record<string, string>;
      expect(() => loadEnv(rest as unknown as NodeJS.ProcessEnv)).toThrowError(
        /JWT_ACCESS_SECRET/,
      );
    });

    it("throws a descriptive error when JWT_REFRESH_SECRET is missing", () => {
      const { JWT_REFRESH_SECRET: _omit, ...rest } = validEnv as Record<string, string>;
      expect(() => loadEnv(rest as unknown as NodeJS.ProcessEnv)).toThrowError(
        /JWT_REFRESH_SECRET/,
      );
    });

    it("throws when a JWT secret is shorter than 32 characters", () => {
      const broken = { ...validEnv, JWT_ACCESS_SECRET: "too-short" } as unknown as NodeJS.ProcessEnv;
      expect(() => loadEnv(broken)).toThrowError(/JWT_ACCESS_SECRET/);
    });
  });

  describe("Phase 2 — SMTP", () => {
    it("is not configured when no SMTP_* variable is set", () => {
      const env = loadEnv(validEnv);
      expect(isSmtpConfigured(env)).toBe(false);
    });

    it("is configured when every SMTP_* variable is set", () => {
      const env = loadEnv({
        ...validEnv,
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "user",
        SMTP_PASSWORD: "pass",
        SMTP_FROM: "noreply@example.com",
      } as unknown as NodeJS.ProcessEnv);
      expect(isSmtpConfigured(env)).toBe(true);
      expect(env.SMTP_PORT).toBe(587);
      expect(env.SMTP_SECURE).toBe(false);
    });

    it("throws when SMTP is only partially configured", () => {
      const broken = {
        ...validEnv,
        SMTP_HOST: "smtp.example.com",
        // SMTP_PORT/USER/PASSWORD/FROM intentionally omitted
      } as unknown as NodeJS.ProcessEnv;
      expect(() => loadEnv(broken)).toThrowError(/SMTP_PORT/);
    });
  });
});
