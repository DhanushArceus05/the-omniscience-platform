import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { registerAndVerifyUser, registerVerifyAndLogin } from "./helpers/auth-test-helpers";
import { createTestApp } from "./helpers/create-test-app";
import type { FakeMailService } from "./helpers/fake-mail.service";

/**
 * Exercises the real HTTP surface of Phase 2 Step 8: `DELETE /users/me`
 * (permanently delete the caller's own account), without requiring a
 * live Postgres or Redis instance, and with the real, unmodified global
 * `ThrottlerGuard` active throughout.
 *
 * Uses the same shared `test/helpers/` fakes and `createTestApp()`
 * helper every other e2e spec in this directory uses — see
 * `test/users-profile.e2e-spec.ts`'s doc comment for why this file's
 * own setup (via `registerVerifyAndLogin()`) genuinely needs the full
 * fake-Redis `EVAL` surface, not just whatever `DELETE /users/me`
 * itself touches.
 *
 * Every test gets its own fresh `INestApplication` via
 * `beforeEach`/`afterEach` (same reasoning as every other e2e spec's
 * per-test describe block from Step 5 onward): a fresh `TestingModule`
 * compile means a fresh, empty in-memory `ThrottlerStorageService`, so
 * no test can be pushed over `DELETE /users/me`'s real (deliberately
 * tight, 3/10min) throttle limit by an earlier test's requests, and
 * each test seeds its own registered/verified/logged-in user(s) rather
 * than depending on another test or on execution order.
 */
describe("Account deletion (e2e, Phase 2 Step 8)", () => {
  let app: INestApplication;
  let mail: FakeMailService;

  const password = "Sup3r$ecretPassw0rd!";

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
    mail = created.mail;
  });

  afterEach(async () => {
    await app.close();
  });

  it("permanently deletes the account: the same email can register fresh afterward, and every outstanding session is revoked", async () => {
    const email = "delete-me@example.com";
    const name = "Deleting Myself";
    await registerAndVerifyUser(app, mail, email, password, name);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    const accessToken = login.body.data.accessToken as string;
    const refreshToken = login.body.data.refreshToken as string;

    const deleteResponse = await request(app.getHttpServer())
      .delete("/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password })
      .expect(200);
    expect(deleteResponse.body).toEqual({ success: true, data: { deleted: true } });

    // The (still cryptographically valid, stateless) access token no
    // longer resolves to a real account — same "gone user" response
    // /auth/me has always given for this scenario since Step 4.
    const meAttempt = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(401);
    expect(meAttempt.body.error.code).toBe("UNAUTHORIZED");

    // The refresh token was explicitly revoked (Step 8's
    // revokeAllForUser), not just orphaned.
    const refreshAttempt = await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken })
      .expect(401);
    expect(refreshAttempt.body.error.code).toBe("REFRESH_TOKEN_INVALID");

    // Logging in with the deleted account's credentials fails exactly
    // like an unknown email — no trace of the old account remains.
    const loginAttempt = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password })
      .expect(401);
    expect(loginAttempt.body.error.code).toBe("INVALID_CREDENTIALS");

    // The email is genuinely free again — a fresh registration for the
    // same address succeeds instead of hitting EMAIL_ALREADY_REGISTERED.
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password, name: "A New Person" })
      .expect(202);
  });

  it("revokes every session, not just the one used to call the endpoint", async () => {
    const email = "delete-multi-session@example.com";
    const name = "Multi Session Deleter";
    await registerAndVerifyUser(app, mail, email, password, name);

    const firstLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    const firstRefreshToken = firstLogin.body.data.refreshToken as string;

    const secondLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    const secondAccessToken = secondLogin.body.data.accessToken as string;

    await request(app.getHttpServer())
      .delete("/users/me")
      .set("Authorization", `Bearer ${secondAccessToken}`)
      .send({ password })
      .expect(200);

    const refreshAttempt = await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: firstRefreshToken })
      .expect(401);
    expect(refreshAttempt.body.error.code).toBe("REFRESH_TOKEN_INVALID");
  });

  it("rejects the wrong password, deleting nothing", async () => {
    const accessToken = await registerVerifyAndLogin(
      app,
      mail,
      "delete-wrong-password@example.com",
      password,
      "Wrong Password",
    );

    const response = await request(app.getHttpServer())
      .delete("/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: "TotallyWrongPassw0rd!" })
      .expect(400);
    expect(response.body.error.code).toBe("CURRENT_PASSWORD_INCORRECT");

    // The account is untouched — the same access token still works.
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
  });

  it("rejects an unauthenticated request", async () => {
    const response = await request(app.getHttpServer())
      .delete("/users/me")
      .send({ password })
      .expect(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a malformed payload", async () => {
    const accessToken = await registerVerifyAndLogin(
      app,
      mail,
      "delete-malformed@example.com",
      password,
      "Malformed Payload",
    );

    const response = await request(app.getHttpServer())
      .delete("/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({})
      .expect(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");

    // Nothing was deleted — the account still works.
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
  });
});
