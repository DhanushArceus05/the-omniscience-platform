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

  describe("Phase 2 — OTP", () => {
    it("applies the approved OTP defaults (10m TTL, 5 attempts, 60s cooldown)", () => {
      const env = loadEnv(validEnv);
      expect(env.OTP_TTL_SECONDS).toBe(600);
      expect(env.OTP_MAX_ATTEMPTS).toBe(5);
      expect(env.OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
    });

    it("allows overriding the OTP defaults", () => {
      const env = loadEnv({
        ...validEnv,
        OTP_TTL_SECONDS: "120",
        OTP_MAX_ATTEMPTS: "3",
        OTP_RESEND_COOLDOWN_SECONDS: "30",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.OTP_TTL_SECONDS).toBe(120);
      expect(env.OTP_MAX_ATTEMPTS).toBe(3);
      expect(env.OTP_RESEND_COOLDOWN_SECONDS).toBe(30);
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

    it("allows an unconfigured SMTP fallback in development", () => {
      const env = loadEnv({ ...validEnv, NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv);
      expect(isSmtpConfigured(env)).toBe(false);
    });

    it("allows an unconfigured SMTP fallback in test", () => {
      const env = loadEnv({ ...validEnv, NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv);
      expect(isSmtpConfigured(env)).toBe(false);
    });

    it("throws a descriptive error when SMTP is unset in production", () => {
      const broken = { ...validEnv, NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv;
      expect(() => loadEnv(broken)).toThrowError(/SMTP_HOST/);
    });

    it("succeeds in production once SMTP is fully configured", () => {
      const env = loadEnv({
        ...validEnv,
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "user",
        SMTP_PASSWORD: "pass",
        SMTP_FROM: "noreply@example.com",
      } as unknown as NodeJS.ProcessEnv);
      expect(isSmtpConfigured(env)).toBe(true);
    });
  });

  describe("Phase 3 Step 3 — avatar storage", () => {
    it("applies the approved defaults when unset", () => {
      const env = loadEnv(validEnv);
      expect(env.AVATAR_STORAGE_DIR).toBe("./storage/avatars");
      expect(env.AVATAR_PUBLIC_BASE_URL).toBe("http://localhost:4000");
      expect(env.AVATAR_MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
    });

    it("allows overriding every avatar-storage variable", () => {
      const env = loadEnv({
        ...validEnv,
        AVATAR_STORAGE_DIR: "/var/data/avatars",
        AVATAR_PUBLIC_BASE_URL: "https://api.example.com",
        AVATAR_MAX_UPLOAD_BYTES: "1048576",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.AVATAR_STORAGE_DIR).toBe("/var/data/avatars");
      expect(env.AVATAR_PUBLIC_BASE_URL).toBe("https://api.example.com");
      expect(env.AVATAR_MAX_UPLOAD_BYTES).toBe(1048576);
    });
  });

  describe("Phase 4 Step 1 — OmniProvider credentials", () => {
    it("succeeds with none of the three provider keys set", () => {
      const env = loadEnv(validEnv);
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it("allows configuring any subset of provider keys independently", () => {
      const env = loadEnv({
        ...validEnv,
        GEMINI_API_KEY: "gemini-key",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.GEMINI_API_KEY).toBe("gemini-key");
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it("succeeds in production with no provider keys set (unlike SMTP, these are never mandatory)", () => {
      const env = loadEnv({
        ...validEnv,
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "user",
        SMTP_PASSWORD: "pass",
        SMTP_FROM: "noreply@example.com",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });
  });
});
