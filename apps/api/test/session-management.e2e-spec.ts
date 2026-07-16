import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { registerAndVerifyUser, registerVerifyAndLogin } from "./helpers/auth-test-helpers";
import { createTestApp } from "./helpers/create-test-app";
import type { FakeMailService } from "./helpers/fake-mail.service";

/**
 * Exercises the real HTTP surface of Phase 2 Step 7:
 * `GET /auth/sessions`, `DELETE /auth/sessions/:tokenId`, and
 * `POST /auth/sessions/revoke-all` — without requiring a live Postgres
 * or Redis instance, and with the real, unmodified global
 * `ThrottlerGuard` active throughout. Uses the same shared
 * `test/helpers/` fakes and `createTestApp()` helper every other e2e
 * spec in this file uses — see `test/auth-registration.e2e-spec.ts`'s
 * doc comment for what each one implements and why.
 *
 * Every test gets its own fresh `INestApplication` via
 * `beforeEach`/`afterEach` (same reasoning as Step 5/Step 6's describe
 * blocks): a fresh `TestingModule` compile means a fresh, empty
 * in-memory `ThrottlerStorageService`, so no test can be pushed over a
 * real per-route throttle limit by an earlier test's requests, and each
 * test seeds its own registered/verified/logged-in user(s) rather than
 * depending on another test or on execution order.
 */
describe("Session management (e2e, Phase 2 Step 7)", () => {
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

  describe("GET /auth/sessions", () => {
    it("lists the single active session created by login", async () => {
      const email = "sessions-list@example.com";
      const accessToken = await registerVerifyAndLogin(app, mail, email, password, "Session Lister");

      const response = await request(app.getHttpServer())
        .get("/auth/sessions")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual({
        tokenId: expect.any(String),
        createdAt: expect.any(String),
      });
    });

    it("lists a session per login, newest first", async () => {
      const email = "sessions-multiple@example.com";
      const name = "Multi Session";
      await registerAndVerifyUser(app, mail, email, password, name);

      await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(200);
      const secondLogin = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(200);
      const accessToken = secondLogin.body.data.accessToken as string;

      const response = await request(app.getHttpServer())
        .get("/auth/sessions")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      const [newest, oldest] = response.body.data as Array<{ createdAt: string }>;
      expect(new Date(newest.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(oldest.createdAt).getTime(),
      );
    });

    it("rejects an unauthenticated request", async () => {
      const response = await request(app.getHttpServer()).get("/auth/sessions").expect(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("DELETE /auth/sessions/:tokenId", () => {
    it("revokes exactly the targeted session, leaving the other one active", async () => {
      const email = "sessions-revoke-one@example.com";
      const name = "Revoke One";
      await registerAndVerifyUser(app, mail, email, password, name);

      const firstLogin = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(200);
      const firstRefreshToken = firstLogin.body.data.refreshToken as string;
      // `tokenId` is documented (packages/types/src/auth.ts) as the
      // non-secret half of `${tokenId}.${secret}` — safe to derive
      // client-side, exactly as a real client listing its own sessions
      // would never need to.
      const firstTokenId = firstRefreshToken.split(".")[0];

      const secondLogin = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(200);
      const accessToken = secondLogin.body.data.accessToken as string;
      const secondRefreshToken = secondLogin.body.data.refreshToken as string;

      const before = await request(app.getHttpServer())
        .get("/auth/sessions")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(before.body.data).toHaveLength(2);

      const revokeResponse = await request(app.getHttpServer())
        .delete(`/auth/sessions/${firstTokenId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(revokeResponse.body).toEqual({ success: true, data: { revoked: true } });

      const after = await request(app.getHttpServer())
        .get("/auth/sessions")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(after.body.data).toHaveLength(1);
      expect(after.body.data[0].tokenId).not.toBe(firstTokenId);

      const revokedAttempt = await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: firstRefreshToken })
        .expect(401);
      expect(revokedAttempt.body.error.code).toBe("REFRESH_TOKEN_INVALID");

      // The other, untouched session's refresh token still works.
      await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: secondRefreshToken })
        .expect(200);
    });

    it("rejects revoking a session that belongs to a different user (404, same as unknown)", async () => {
      const ownerAccessToken = await registerVerifyAndLogin(
        app,
        mail,
        "sessions-owner@example.com",
        password,
        "Owner",
      );
      const otherAccessToken = await registerVerifyAndLogin(
        app,
        mail,
        "sessions-other@example.com",
        password,
        "Other",
      );

      const ownerSessions = await request(app.getHttpServer())
        .get("/auth/sessions")
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .expect(200);
      const ownerTokenId = ownerSessions.body.data[0].tokenId as string;

      const response = await request(app.getHttpServer())
        .delete(`/auth/sessions/${ownerTokenId}`)
        .set("Authorization", `Bearer ${otherAccessToken}`)
        .expect(404);
      expect(response.body.error.code).toBe("SESSION_NOT_FOUND");

      // The owner's own session must be untouched by the other user's attempt.
      const stillThere = await request(app.getHttpServer())
        .get("/auth/sessions")
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .expect(200);
      expect(stillThere.body.data).toHaveLength(1);
    });

    it("rejects an unknown (but well-formed) tokenId with the same 404", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "sessions-unknown-id@example.com",
        password,
        "Unknown Id",
      );

      const response = await request(app.getHttpServer())
        .delete("/auth/sessions/00000000-0000-4000-8000-000000000000")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404);
      expect(response.body.error.code).toBe("SESSION_NOT_FOUND");
    });

    it("rejects a malformed tokenId with a validation error", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "sessions-malformed-id@example.com",
        password,
        "Malformed Id",
      );

      const response = await request(app.getHttpServer())
        .delete("/auth/sessions/not-a-uuid")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects an unauthenticated request", async () => {
      const response = await request(app.getHttpServer())
        .delete("/auth/sessions/00000000-0000-4000-8000-000000000000")
        .expect(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("POST /auth/sessions/revoke-all", () => {
    it("revokes every active session for the caller", async () => {
      const email = "sessions-revoke-all@example.com";
      const name = "Revoke All";
      await registerAndVerifyUser(app, mail, email, password, name);

      await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(200);
      await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(200);
      const thirdLogin = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(200);
      const accessToken = thirdLogin.body.data.accessToken as string;
      const lastRefreshToken = thirdLogin.body.data.refreshToken as string;

      const response = await request(app.getHttpServer())
        .post("/auth/sessions/revoke-all")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(response.body).toEqual({ success: true, data: { revokedCount: 3 } });

      const after = await request(app.getHttpServer())
        .get("/auth/sessions")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(after.body.data).toEqual([]);

      const refreshAttempt = await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: lastRefreshToken })
        .expect(401);
      expect(refreshAttempt.body.error.code).toBe("REFRESH_TOKEN_INVALID");
    });

    it("returns a zero count when the caller has no active sessions left to revoke", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "sessions-revoke-all-empty@example.com",
        password,
        "Nothing To Revoke",
      );

      await request(app.getHttpServer())
        .post("/auth/sessions/revoke-all")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .post("/auth/sessions/revoke-all")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(response.body).toEqual({ success: true, data: { revokedCount: 0 } });
    });

    it("rejects an unauthenticated request", async () => {
      const response = await request(app.getHttpServer())
        .post("/auth/sessions/revoke-all")
        .expect(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });
  });
});
