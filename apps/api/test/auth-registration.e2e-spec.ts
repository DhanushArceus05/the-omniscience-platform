import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import type Redis from "ioredis";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { ENV } from "../src/config/config.constants";
import type { SendMailInput } from "../src/mail/mail.service";
import { MailService } from "../src/mail/mail.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";

/**
 * Exercises the real HTTP surface of Step 3 (register → verify-otp,
 * including a wrong-code rejection and a duplicate-email rejection) and
 * Step 4 (login → me → refresh (rotation) → logout, plus the
 * unverified/wrong-password/invalid-token rejections) without requiring
 * a live Postgres or Redis instance.
 *
 * `PrismaService` is replaced with a tiny in-memory `users` array, and
 * `RedisService` with an in-memory key/value store that also implements
 * `EVAL` for the three atomic Lua scripts `PendingRegistrationStore`/
 * `RefreshTokenStore` use — both implement only the surface
 * `AuthService`/`PendingRegistrationStore`/`RefreshTokenStore` actually
 * call, not a full Prisma/Redis client. `MailService` is replaced with a fake that
 * captures sent messages so the test can read the real generated OTP out
 * of the (never-logged-in-plaintext-elsewhere) email body, exactly as a
 * person would read it from their inbox.
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
  OTP_TTL_SECONDS: 600,
  OTP_MAX_ATTEMPTS: 5,
  OTP_RESEND_COOLDOWN_SECONDS: 60,
};

interface FakeUserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

class FakePrismaService {
  private readonly users: FakeUserRow[] = [];

  user = {
    findUnique: async ({
      where,
    }: {
      where: { email?: string; id?: string };
    }): Promise<FakeUserRow | null> =>
      this.users.find(
        (u) => (where.email !== undefined && u.email === where.email) || u.id === where.id,
      ) ?? null,
    create: async ({
      data,
    }: {
      data: { email: string; passwordHash: string; name: string; emailVerifiedAt: Date };
    }): Promise<FakeUserRow> => {
      if (this.users.some((u) => u.email === data.email)) {
        throw Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), {
          code: "P2002",
        });
      }
      const row: FakeUserRow = {
        id: `user_${this.users.length + 1}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.users.push(row);
      return row;
    },
  };

  async onModuleInit(): Promise<void> {
    // no-op
  }

  async onModuleDestroy(): Promise<void> {
    // no-op
  }
}

class InMemoryRedisClient {
  private readonly store = new Map<string, { value: string; expiresAtMs: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== null && entry.expiresAtMs < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ..._options: unknown[]): Promise<"OK"> {
    this.store.set(key, { value, expiresAtMs: null });
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  /**
   * Minimal same-process stand-in for Redis's `EVAL`. This test never runs
   * concurrent requests (supertest sends them one at a time), so it only
   * needs to reproduce the two Lua scripts' *logic*, not their atomicity —
   * atomicity itself is proven separately, against real Redis, in
   * `pending-registration.store.concurrency.spec.ts`. Dispatches on the
   * `-- SCRIPT: ...` marker comment each script starts with, so this fake
   * doesn't have to parse or interpret Lua.
   */
  async eval(script: string, _numKeys: number, key: string, ...args: unknown[]): Promise<unknown> {
    if (script.includes("-- SCRIPT: pending-registration-claim-send")) {
      const [cooldownSeconds, ttlSeconds, nowMs, newRecord] = args as [number, number, number, string];
      const entry = this.store.get(key);
      if (entry) {
        const decoded = JSON.parse(entry.value) as { lastOtpSentAtMs?: number };
        if (typeof decoded.lastOtpSentAtMs === "number") {
          const elapsedSeconds = (Number(nowMs) - decoded.lastOtpSentAtMs) / 1000;
          const remainingSeconds = Number(cooldownSeconds) - elapsedSeconds;
          if (remainingSeconds > 0) {
            return ["COOLDOWN", String(remainingSeconds)];
          }
        }
      }
      this.store.set(key, {
        value: newRecord,
        expiresAtMs: Date.now() + Number(ttlSeconds) * 1000,
      });
      return ["OK"];
    }

    if (script.includes("-- SCRIPT: pending-registration-record-failed-attempt")) {
      const [maxAttempts, nowMs] = args as [number, number];
      const entry = this.store.get(key);
      if (!entry) {
        return ["NOT_FOUND"];
      }
      const decoded = JSON.parse(entry.value) as {
        otpAttempts: number;
        otpExpiresAtMs?: number;
      };
      if (typeof decoded.otpExpiresAtMs === "number" && decoded.otpExpiresAtMs < Number(nowMs)) {
        this.store.delete(key);
        return ["EXPIRED"];
      }
      if (decoded.otpAttempts >= Number(maxAttempts)) {
        this.store.delete(key);
        return ["MAX_ATTEMPTS_EXCEEDED"];
      }
      decoded.otpAttempts += 1;
      if (decoded.otpAttempts >= Number(maxAttempts)) {
        this.store.delete(key);
        return ["MAX_ATTEMPTS_EXCEEDED"];
      }
      // KEEPTTL semantics: preserve the existing expiresAtMs untouched.
      this.store.set(key, { value: JSON.stringify(decoded), expiresAtMs: entry.expiresAtMs });
      return ["INCREMENTED", String(Number(maxAttempts) - decoded.otpAttempts)];
    }

    if (script.includes("-- SCRIPT: refresh-token-consume")) {
      const entry = this.store.get(key);
      if (!entry) {
        return false;
      }
      this.store.delete(key);
      return entry.value;
    }

    throw new Error("InMemoryRedisClient.eval: unrecognized script");
  }
}

class FakeRedisService {
  private readonly client = new InMemoryRedisClient();

  async onModuleInit(): Promise<void> {
    // no-op
  }

  onModuleDestroy(): void {
    // no-op
  }

  getClient(): Redis {
    return this.client as unknown as Redis;
  }
}

class FakeMailService {
  sentEmails: SendMailInput[] = [];

  async sendMail(input: SendMailInput): Promise<void> {
    this.sentEmails.push(input);
  }

  isConfigured(): boolean {
    return false;
  }
}

describe("Auth registration + OTP verification (e2e)", () => {
  let app: INestApplication | undefined;
  let mail: FakeMailService;

  beforeAll(async () => {
    mail = new FakeMailService();
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

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(createLogger({ service: "api-test" })));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const email = "new.user@example.com";
  const password = "Sup3r$ecretPassw0rd!";

  function extractOtp(): string {
    const sent = mail.sentEmails.find((m) => m.to === email);
    expect(sent).toBeDefined();
    const match = sent?.text.match(/\d{6}/);
    expect(match).toBeTruthy();
    return match?.[0] as string;
  }

  it("registers, sends an OTP, rejects a wrong code, then accepts the right one", async () => {
    const registerResponse = await request(app?.getHttpServer())
      .post("/auth/register")
      .send({ email, password, name: "New User" })
      .expect(202);

    expect(registerResponse.body).toEqual({
      success: true,
      data: { email, otpExpiresInSeconds: 600 },
    });

    const otp = extractOtp();
    const wrongOtp = otp === "000000" ? "111111" : "000000";

    const wrongAttempt = await request(app?.getHttpServer())
      .post("/auth/verify-otp")
      .send({ email, otp: wrongOtp })
      .expect(400);
    expect(wrongAttempt.body.error.code).toBe("OTP_INCORRECT");

    const verifyResponse = await request(app?.getHttpServer())
      .post("/auth/verify-otp")
      .send({ email, otp })
      .expect(201);

    expect(verifyResponse.body.success).toBe(true);
    expect(verifyResponse.body.data.email).toBe(email);
    expect(typeof verifyResponse.body.data.userId).toBe("string");
  });

  it("rejects registering an email that is already verified", async () => {
    const response = await request(app?.getHttpServer())
      .post("/auth/register")
      .send({ email, password, name: "New User" })
      .expect(409);

    expect(response.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("rejects a malformed registration payload with structured validation details", async () => {
    const response = await request(app?.getHttpServer())
      .post("/auth/register")
      .send({ email: "not-an-email", password: "short", name: "A" })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(response.body.error.details)).toBe(true);
    expect(response.body.error.details.length).toBeGreaterThan(0);
  });

  describe("login, refresh, logout, and /auth/me (Step 4)", () => {
    // `email`/`password` above were registered and verified by the very
    // first test in this file — reused here rather than duplicating the
    // whole register→verify flow.
    let accessToken: string;
    let refreshToken: string;

    it("logs in the verified user and returns an access token + refresh token", async () => {
      const response = await request(app?.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(typeof response.body.data.accessToken).toBe("string");
      expect(typeof response.body.data.refreshToken).toBe("string");
      expect(response.body.data.accessTokenExpiresInSeconds).toBe(900);
      expect(response.body.data.refreshTokenExpiresInSeconds).toBe(604800);
      expect(response.body.data.user).toEqual({
        id: expect.any(String),
        email,
        name: "New User",
      });

      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;
    });

    it("rejects login with the wrong password", async () => {
      const response = await request(app?.getHttpServer())
        .post("/auth/login")
        .send({ email, password: "wrong-password-entirely" })
        .expect(401);

      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("rejects login for an email that was never registered", async () => {
      const response = await request(app?.getHttpServer())
        .post("/auth/login")
        .send({ email: "never-registered@example.com", password })
        .expect(401);

      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("rejects login for a registered-but-not-yet-verified email the same as an unknown one", async () => {
      // Registering only creates a pending registration in Redis — the
      // real `User` row is created by `verifyOtp()`, already
      // `emailVerifiedAt`-set, so there is currently no route through the
      // public API that produces a `User` row with `emailVerifiedAt:
      // null`. `AuthService.login()`'s `EMAIL_NOT_VERIFIED` branch is
      // still worth keeping (see its unit test in auth.service.spec.ts,
      // which exercises it directly) as defense-in-depth against a
      // future path — e.g. an admin-created or OAuth-linked account —
      // that could create an unverified `User` row directly. Here, an
      // email that only has a pending registration is indistinguishable
      // from one that was never registered at all.
      const unverifiedEmail = "pending.user@example.com";
      await request(app?.getHttpServer())
        .post("/auth/register")
        .send({ email: unverifiedEmail, password, name: "Pending User" })
        .expect(202);

      const response = await request(app?.getHttpServer())
        .post("/auth/login")
        .send({ email: unverifiedEmail, password })
        .expect(401);

      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("returns the caller's identity from /auth/me with a valid access token", async () => {
      const response = await request(app?.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { id: expect.any(String), email, name: "New User" },
      });
    });

    it("rejects /auth/me without an Authorization header", async () => {
      const response = await request(app?.getHttpServer()).get("/auth/me").expect(401);

      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects /auth/me with a garbage bearer token", async () => {
      const response = await request(app?.getHttpServer())
        .get("/auth/me")
        .set("Authorization", "Bearer not-a-real-token")
        .expect(401);

      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    it("refreshes the session and rotates the refresh token", async () => {
      const usedRefreshToken = refreshToken;

      const response = await request(app?.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: usedRefreshToken })
        .expect(200);

      expect(typeof response.body.data.accessToken).toBe("string");
      expect(typeof response.body.data.refreshToken).toBe("string");
      expect(response.body.data.refreshToken).not.toBe(usedRefreshToken);

      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;

      // The old refresh token is single-use: presenting it again must fail.
      const replay = await request(app?.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: usedRefreshToken })
        .expect(401);
      expect(replay.body.error.code).toBe("REFRESH_TOKEN_INVALID");
    });

    it("logs out, after which the (rotated) refresh token can no longer be used", async () => {
      await request(app?.getHttpServer())
        .post("/auth/logout")
        .send({ refreshToken })
        .expect(200)
        .expect((res) => {
          if (res.body.data.loggedOut !== true) {
            throw new Error("expected loggedOut: true");
          }
        });

      const response = await request(app?.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken })
        .expect(401);
      expect(response.body.error.code).toBe("REFRESH_TOKEN_INVALID");
    });

    it("rejects a malformed login payload with structured validation details", async () => {
      const response = await request(app?.getHttpServer())
        .post("/auth/login")
        .send({ email: "not-an-email" })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
