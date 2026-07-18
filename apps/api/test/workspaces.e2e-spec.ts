import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { registerVerifyAndLogin } from "./helpers/auth-test-helpers";
import { createTestApp } from "./helpers/create-test-app";
import type { FakeMailService } from "./helpers/fake-mail.service";

/**
 * Exercises the real HTTP surface of Phase 3 Step 2 (Workspace Data
 * Model, Ownership Isolation & Dashboard Listing): `POST /workspaces`,
 * `GET /workspaces`, `GET /workspaces/:id` — without requiring a live
 * Postgres/Redis instance, and with the real, unmodified global
 * `ThrottlerGuard` active throughout.
 *
 * Every test gets its own fresh `INestApplication` (same reasoning as
 * `session-management.e2e-spec.ts`): a fresh `TestingModule` compile
 * means a fresh, empty in-memory `ThrottlerStorageService`, so no test
 * can be pushed over a real per-route throttle limit by an earlier
 * test's requests, and each test seeds its own registered/verified/
 * logged-in user(s) rather than depending on another test or on
 * execution order.
 */
describe("Workspaces (e2e, Phase 3 Step 2)", () => {
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

  describe("POST /workspaces", () => {
    it("creates a workspace owned by the caller", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "create@example.com",
        password,
        "Creator",
      );

      const response = await request(app.getHttpServer())
        .post("/workspaces")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Research", description: "Deep-dive projects" })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        id: expect.any(String),
        name: "Research",
        description: "Deep-dive projects",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("creates a workspace with no description", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "create-no-desc@example.com",
        password,
        "Creator",
      );

      const response = await request(app.getHttpServer())
        .post("/workspaces")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Research" })
        .expect(201);

      expect(response.body.data.description).toBeNull();
    });

    it("rejects a missing name with a structured validation error", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "create-invalid@example.com",
        password,
        "Creator",
      );

      const response = await request(app.getHttpServer())
        .post("/workspaces")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects an unknown field", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "create-unknown-field@example.com",
        password,
        "Creator",
      );

      const response = await request(app.getHttpServer())
        .post("/workspaces")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Research", ownerId: "someone-else" })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects an unauthenticated request", async () => {
      await request(app.getHttpServer())
        .post("/workspaces")
        .send({ name: "Research" })
        .expect(401);
    });
  });

  describe("GET /workspaces", () => {
    it("lists only the caller's own workspaces, newest first", async () => {
      const tokenA = await registerVerifyAndLogin(app, mail, "owner-a@example.com", password, "Owner A");
      const tokenB = await registerVerifyAndLogin(app, mail, "owner-b@example.com", password, "Owner B");

      await request(app.getHttpServer())
        .post("/workspaces")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ name: "A First" })
        .expect(201);
      await request(app.getHttpServer())
        .post("/workspaces")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ name: "A Second" })
        .expect(201);
      await request(app.getHttpServer())
        .post("/workspaces")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ name: "B Only" })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get("/workspaces")
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(response.body.data.workspaces).toHaveLength(2);
      expect(response.body.data.workspaces.map((w: { name: string }) => w.name)).toEqual([
        "A Second",
        "A First",
      ]);
      expect(response.body.data.nextCursor).toBeNull();
    });

    it("returns an empty list for a user with no workspaces", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "no-workspaces@example.com",
        password,
        "Empty Owner",
      );

      const response = await request(app.getHttpServer())
        .get("/workspaces")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toEqual({ workspaces: [], nextCursor: null });
    });

    it("paginates with a bounded limit and a usable nextCursor", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "paginate@example.com",
        password,
        "Paginator",
      );

      for (const name of ["First", "Second", "Third"]) {
        await request(app.getHttpServer())
          .post("/workspaces")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({ name })
          .expect(201);
      }

      const firstPage = await request(app.getHttpServer())
        .get("/workspaces?limit=2")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(firstPage.body.data.workspaces).toHaveLength(2);
      expect(firstPage.body.data.workspaces.map((w: { name: string }) => w.name)).toEqual([
        "Third",
        "Second",
      ]);
      expect(firstPage.body.data.nextCursor).toEqual(expect.any(String));

      const secondPage = await request(app.getHttpServer())
        .get(`/workspaces?limit=2&cursor=${encodeURIComponent(firstPage.body.data.nextCursor)}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(secondPage.body.data.workspaces).toHaveLength(1);
      expect(secondPage.body.data.workspaces[0].name).toBe("First");
      expect(secondPage.body.data.nextCursor).toBeNull();
    });

    it("rejects a limit above the safe maximum", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "limit-too-high@example.com",
        password,
        "Limiter",
      );

      const response = await request(app.getHttpServer())
        .get("/workspaces?limit=999")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a malformed cursor", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "bad-cursor@example.com",
        password,
        "Cursor Tester",
      );

      const response = await request(app.getHttpServer())
        .get("/workspaces?cursor=not-a-real-cursor")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(400);

      expect(response.body.error.code).toBe("INVALID_CURSOR");
    });

    it("rejects an unauthenticated request", async () => {
      await request(app.getHttpServer()).get("/workspaces").expect(401);
    });
  });

  describe("GET /workspaces/:id", () => {
    it("returns the caller's own workspace", async () => {
      const accessToken = await registerVerifyAndLogin(
        app,
        mail,
        "get-own@example.com",
        password,
        "Getter",
      );
      const created = await request(app.getHttpServer())
        .post("/workspaces")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Research" })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/workspaces/${created.body.data.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.id).toBe(created.body.data.id);
      expect(response.body.data.name).toBe("Research");
    });

    it("returns WORKSPACE_NOT_FOUND for another user's workspace id", async () => {
      const tokenA = await registerVerifyAndLogin(
        app,
        mail,
        "isolation-owner@example.com",
        password,
        "Owner",
      );
      const tokenB = await registerVerifyAndLogin(
        app,
        mail,
        "isolation-intruder@example.com",
        password,
        "Intruder",
      );
      const created = await request(app.getHttpServer())
        .post("/workspaces")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ name: "Owner's Workspace" })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/workspaces/${created.body.data.id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);

      expect(response.body.error.code).toBe("WORKSPACE_NOT_FOUND");
    });

    it("returns the identical response for a nonexistent id as for another owner's id", async () => {
      const tokenA = await registerVerifyAndLogin(
        app,
        mail,
        "identical-response-owner@example.com",
        password,
        "Owner",
      );
      const tokenB = await registerVerifyAndLogin(
        app,
        mail,
        "identical-response-intruder@example.com",
        password,
        "Intruder",
      );
      const created = await request(app.getHttpServer())
        .post("/workspaces")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ name: "Owner's Workspace" })
        .expect(201);

      const otherOwnersWorkspace = await request(app.getHttpServer())
        .get(`/workspaces/${created.body.data.id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);

      const nonexistent = await request(app.getHttpServer())
        .get("/workspaces/does-not-exist")
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);

      expect(otherOwnersWorkspace.body).toEqual(nonexistent.body);
    });

    it("rejects an unauthenticated request", async () => {
      await request(app.getHttpServer()).get("/workspaces/whatever").expect(401);
    });
  });
});
