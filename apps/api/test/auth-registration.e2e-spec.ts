import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { extractOtpFor, registerAndVerifyUser } from "./helpers/auth-test-helpers";
import { createTestApp } from "./helpers/create-test-app";
import type { FakeMailService } from "./helpers/fake-mail.service";

/**
 * Exercises the real HTTP surface of Step 3 (register → verify-otp,
 * including a wrong-code rejection and a duplicate-email rejection),
 * Step 4 (login → me → refresh (rotation) → logout, plus the
 * unverified/wrong-password/invalid-token rejections), and Step 5
 * (forgot-password → reset-password, including a wrong-code rejection
 * and the unknown-email/unverified-email non-enumeration behavior)
 * without requiring a live Postgres or Redis instance, and with the
 * real, unmodified global `ThrottlerGuard` active throughout.
 *
 * The fake `PrismaService`/`RedisService`/`MailService`, the shared
 * `testEnv`, and the `createTestApp()` helper that wires them all
 * together all live under `test/helpers/` — shared with
 * `test/users-profile.e2e-spec.ts` (and any future e2e spec) rather than
 * each file keeping its own copy. See each helper module's own doc
 * comment (`test/helpers/fake-prisma.service.ts`,
 * `fake-redis.service.ts`, `fake-mail.service.ts`, `create-test-app.ts`,
 * `auth-test-helpers.ts`) for what each one implements and why.
 *
 * **Test isolation and `ThrottlerGuard`.** `ThrottlerGuard` is never
 * overridden, stubbed, or bypassed anywhere in this file — production
 * throttling runs for real on every request the tests make. What *is*
 * isolated is application state: each call to `createTestApp()` compiles
 * a brand-new DI container, which means a brand-new (empty, in-memory)
 * `ThrottlerStorageService` — i.e. a fresh per-IP rate-limit counter
 * that starts at zero. The Step 3 + Step 4 tests (registration through
 * login/refresh/logout) share one `INestApplication`, created once in
 * the top-level `beforeAll`, because they form one continuous, ordered
 * story about a single account and stay comfortably within every
 * route's throttle limit doing so. The Step 5 (`forgot-password`/
 * `reset-password`) tests instead each get their **own** fresh
 * `INestApplication` via `beforeEach`/`afterEach` — every test seeds
 * whatever verified/unverified user it needs itself (via
 * `registerAndVerifyUser()`), rather than depending on the top-level
 * describe block's account or on execution order relative to other
 * Step 5 tests. This guarantees no Step 5 test can ever be pushed over
 * `/auth/forgot-password`'s real 3-per-10-minutes production limit by
 * an earlier, unrelated test's requests: each test's own budget always
 * starts fresh, and no single Step 5 test needs more than one
 * `/auth/forgot-password` call to exercise what it's testing.
 */

describe("Auth registration + OTP verification (e2e)", () => {
  let app: INestApplication | undefined;
  let mail: FakeMailService;

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    mail = created.mail;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const email = "new.user@example.com";
  const password = "Sup3r$ecretPassw0rd!";

  function extractOtp(): string {
    return extractOtpFor(mail, email);
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
        avatarUrl: null,
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
        data: { id: expect.any(String), email, name: "New User", avatarUrl: null },
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

  describe("forgot-password + reset-password (Step 5)", () => {
    // Deliberately isolated from the rest of this file: every test here
    // gets its own fresh `INestApplication` (via `createTestApp()`, in
    // `beforeEach`/`afterEach` below) and seeds whatever verified/
    // unverified user it needs itself (via `registerAndVerifyUser()` or
    // a direct `/auth/register` call), rather than reusing the top-level
    // describe block's `app`/`email`/`password` or depending on another
    // Step 5 test having already run. See the class-level doc comment
    // for why a fresh app per test is what actually keeps these tests
    // independent of `ThrottlerGuard`'s real, unmodified, per-IP rate
    // limit on `/auth/forgot-password` — each test's own budget starts
    // at zero, and none of them needs more than one
    // `/auth/forgot-password` call to exercise what it's testing.
    let step5App: INestApplication;
    let step5Mail: FakeMailService;

    const password = "Sup3r$ecretPassw0rd!";
    const newPassword = "N3wSup3r$ecretPassw0rd!";

    beforeEach(async () => {
      const created = await createTestApp();
      step5App = created.app;
      step5Mail = created.mail;
    });

    afterEach(async () => {
      await step5App.close();
    });

    it("returns the same generic response for an unregistered email and sends nothing", async () => {
      const response = await request(step5App.getHttpServer())
        .post("/auth/forgot-password")
        .send({ email: "never-registered@example.com" })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { email: "never-registered@example.com", otpExpiresInSeconds: 600 },
      });
      expect(step5Mail.sentEmails).toHaveLength(0);
    });

    it("sends a reset OTP for a registered, verified account with the same response shape", async () => {
      const email = "reset-flow-send-otp@example.com";
      await registerAndVerifyUser(step5App, step5Mail, email, password, "Reset Flow Send Otp");
      const before = step5Mail.sentEmails.length;

      const response = await request(step5App.getHttpServer())
        .post("/auth/forgot-password")
        .send({ email })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { email, otpExpiresInSeconds: 600 },
      });
      expect(step5Mail.sentEmails.length).toBe(before + 1);
    });

    it("rejects reset-password with a wrong code", async () => {
      const email = "reset-flow-wrong-code@example.com";
      await registerAndVerifyUser(step5App, step5Mail, email, password, "Reset Flow Wrong Code");
      await request(step5App.getHttpServer())
        .post("/auth/forgot-password")
        .send({ email })
        .expect(200);
      const otp = extractOtpFor(step5Mail, email);
      const wrongOtp = otp === "000000" ? "111111" : "000000";

      const response = await request(step5App.getHttpServer())
        .post("/auth/reset-password")
        .send({ email, otp: wrongOtp, newPassword })
        .expect(400);

      expect(response.body.error.code).toBe("OTP_INCORRECT");
    });

    it("resets the password with the correct code, after which the old password no longer works", async () => {
      const email = "reset-flow-success@example.com";
      await registerAndVerifyUser(step5App, step5Mail, email, password, "Reset Flow Success");
      await request(step5App.getHttpServer())
        .post("/auth/forgot-password")
        .send({ email })
        .expect(200);
      const otp = extractOtpFor(step5Mail, email);

      const response = await request(step5App.getHttpServer())
        .post("/auth/reset-password")
        .send({ email, otp, newPassword })
        .expect(200);

      expect(response.body).toEqual({ success: true, data: { email } });

      const oldPasswordAttempt = await request(step5App.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(401);
      expect(oldPasswordAttempt.body.error.code).toBe("INVALID_CREDENTIALS");

      const newPasswordAttempt = await request(step5App.getHttpServer())
        .post("/auth/login")
        .send({ email, password: newPassword })
        .expect(200);
      expect(typeof newPasswordAttempt.body.data.accessToken).toBe("string");
    });

    it("rejects reusing the same reset code a second time", async () => {
      const email = "reset-flow-replay@example.com";
      await registerAndVerifyUser(step5App, step5Mail, email, password, "Reset Flow Replay");
      await request(step5App.getHttpServer())
        .post("/auth/forgot-password")
        .send({ email })
        .expect(200);
      const otp = extractOtpFor(step5Mail, email);

      await request(step5App.getHttpServer())
        .post("/auth/reset-password")
        .send({ email, otp, newPassword })
        .expect(200);

      const replay = await request(step5App.getHttpServer())
        .post("/auth/reset-password")
        .send({ email, otp, newPassword: "YetAnotherPassw0rd!" })
        .expect(404);
      expect(replay.body.error.code).toBe("PASSWORD_RESET_NOT_FOUND");
    });

    it("returns the same generic response for a registered-but-not-yet-verified email and sends nothing", async () => {
      const unverifiedEmail = "reset-flow-unverified@example.com";
      await request(step5App.getHttpServer())
        .post("/auth/register")
        .send({ email: unverifiedEmail, password, name: "Reset Flow Unverified" })
        .expect(202);
      const before = step5Mail.sentEmails.length;

      const response = await request(step5App.getHttpServer())
        .post("/auth/forgot-password")
        .send({ email: unverifiedEmail })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { email: unverifiedEmail, otpExpiresInSeconds: 600 },
      });
      // Only the registration OTP was sent, never a reset OTP.
      expect(step5Mail.sentEmails).toHaveLength(before);
    });

    it("rejects reset-password when no reset was ever requested for the email", async () => {
      const response = await request(step5App.getHttpServer())
        .post("/auth/reset-password")
        .send({ email: "no-reset-requested@example.com", otp: "123456", newPassword })
        .expect(404);

      expect(response.body.error.code).toBe("PASSWORD_RESET_NOT_FOUND");
    });

    it("rejects a malformed reset-password payload with structured validation details", async () => {
      const email = "reset-flow-malformed@example.com";
      await registerAndVerifyUser(step5App, step5Mail, email, password, "Reset Flow Malformed");

      const response = await request(step5App.getHttpServer())
        .post("/auth/reset-password")
        .send({ email, otp: "abc", newPassword: "short" })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
