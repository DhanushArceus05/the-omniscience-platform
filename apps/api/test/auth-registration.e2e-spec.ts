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
 * including a wrong-code rejection and a duplicate-email rejection)
 * without requiring a live Postgres or Redis instance.
 *
 * `PrismaService` is replaced with a tiny in-memory `users` array, and
 * `RedisService` with an in-memory key/value store that also implements
 * `EVAL` for the two atomic Lua scripts `PendingRegistrationStore` uses —
 * both implement only the surface `AuthService`/`PendingRegistrationStore`
 * actually call, not a full Prisma/Redis client. `MailService` is replaced with a fake that
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
    findUnique: async ({ where }: { where: { email: string } }): Promise<FakeUserRow | null> =>
      this.users.find((u) => u.email === where.email) ?? null,
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
});
