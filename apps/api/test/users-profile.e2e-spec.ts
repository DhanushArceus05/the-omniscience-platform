import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { registerVerifyAndLogin } from "./helpers/auth-test-helpers";
import { createTestApp } from "./helpers/create-test-app";
import type { FakeMailService } from "./helpers/fake-mail.service";

/**
 * Exercises the real HTTP surface of Phase 2 Step 6:
 * `PATCH /users/me` (update display name) and
 * `POST /users/me/change-password` (change password while
 * authenticated), without requiring a live Postgres or Redis instance,
 * and with the real, unmodified global `ThrottlerGuard` active
 * throughout.
 *
 * Uses the same shared `test/helpers/` fakes and `createTestApp()`
 * helper `test/auth-registration.e2e-spec.ts` uses — see that file's
 * doc comment, and each helper module's own doc comment, for what each
 * one implements and why. In particular, `FakeRedisService`'s `EVAL`
 * fake supports every atomic Lua script `PendingRegistrationStore`/
 * `PasswordResetStore`/`RefreshTokenStore` use, not just the ones this
 * file's own routes touch directly — this file's setup (via
 * `registerVerifyAndLogin()`) calls `/auth/register` and `/auth/login`
 * to get an authenticated user and access token, and `/auth/register`
 * genuinely calls `PendingRegistrationStore.claimSend()` (Redis `EVAL`)
 * under the hood, exactly as it does in `test/auth-registration.e2e-
 * spec.ts`. An earlier, file-local, simplified Redis fake that only
 * expected `/users/me` routes to ever reach Redis was wrong for that
 * reason — it never accounted for what its own setup helper needed.
 *
 * Every test gets its own fresh `INestApplication` via
 * `beforeEach`/`afterEach` (same reasoning as Step 5's describe block in
 * the auth e2e file): a fresh `TestingModule` compile means a fresh,
 * empty in-memory `ThrottlerStorageService`, so no test can ever be
 * pushed over a real per-route throttle limit by an earlier test's
 * requests, and each test seeds its own registered/verified/logged-in
 * user rather than depending on another test or on execution order.
 */
describe("User profile + change-password (e2e, Phase 2 Step 6)", () => {
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

  describe("PATCH /users/me", () => {
    it("updates the caller's own display name and persists it", async () => {
      const email = "profile-update@example.com";
      const accessToken = await registerVerifyAndLogin(app, mail, email, password, "Original Name");

      const response = await request(app.getHttpServer())
        .patch("/users/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Updated Name" })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { id: expect.any(String), email, name: "Updated Name" },
      });

      const me = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(me.body.data.name).toBe("Updated Name");
    });

    it("rejects an unauthenticated request", async () => {
      const response = await request(app.getHttpServer())
        .patch("/users/me")
        .send({ name: "New Name" })
        .expect(401);

      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects a malformed payload with structured validation details", async () => {
      const email = "profile-update-malformed@example.com";
      const accessToken = await registerVerifyAndLogin(app, mail, email, password, "Original Name");

      const response = await request(app.getHttpServer())
        .patch("/users/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "A" })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /users/me/change-password", () => {
    it("changes the password with the correct current password, after which the old password no longer works", async () => {
      const email = "change-password-success@example.com";
      const newPassword = "N3wSup3r$ecretPassw0rd!";
      const accessToken = await registerVerifyAndLogin(app, mail, email, password, "Change Password");

      const response = await request(app.getHttpServer())
        .post("/users/me/change-password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ currentPassword: password, newPassword })
        .expect(200);

      expect(response.body).toEqual({ success: true, data: { email } });

      const oldPasswordAttempt = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(401);
      expect(oldPasswordAttempt.body.error.code).toBe("INVALID_CREDENTIALS");

      const newPasswordAttempt = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password: newPassword })
        .expect(200);
      expect(typeof newPasswordAttempt.body.data.accessToken).toBe("string");
    });

    it("rejects an incorrect current password without changing anything", async () => {
      const email = "change-password-wrong-current@example.com";
      const accessToken = await registerVerifyAndLogin(app, mail, email, password, "Change Password");

      const response = await request(app.getHttpServer())
        .post("/users/me/change-password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ currentPassword: "TotallyWrongPassw0rd!", newPassword: "N3wSup3r$ecretPassw0rd!" })
        .expect(400);
      expect(response.body.error.code).toBe("CURRENT_PASSWORD_INCORRECT");

      const stillWorksWithOldPassword = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(200);
      expect(typeof stillWorksWithOldPassword.body.data.accessToken).toBe("string");
    });

    it("rejects an unauthenticated request", async () => {
      const response = await request(app.getHttpServer())
        .post("/users/me/change-password")
        .send({ currentPassword: password, newPassword: "N3wSup3r$ecretPassw0rd!" })
        .expect(401);

      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects a malformed payload with structured validation details", async () => {
      const email = "change-password-malformed@example.com";
      const accessToken = await registerVerifyAndLogin(app, mail, email, password, "Change Password");

      const response = await request(app.getHttpServer())
        .post("/users/me/change-password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ currentPassword: password, newPassword: "short" })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
