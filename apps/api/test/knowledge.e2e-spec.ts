import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { registerVerifyAndLogin } from "./helpers/auth-test-helpers";
import { createTestApp } from "./helpers/create-test-app";
import type { FakeMailService } from "./helpers/fake-mail.service";

describe("Knowledge routes (e2e, Phase 7 Steps 1–2)", () => {
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

  async function createWorkspace(token: string, name = "Knowledge") {
    const response = await request(app.getHttpServer())
      .post("/workspaces")
      .set("Authorization", `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return response.body.data.id as string;
  }

  async function login(email: string): Promise<string> {
    return registerVerifyAndLogin(app, mail, email, password, "Knowledge User");
  }

  it("uploads, lists, gets, downloads, and deletes a workspace file", async () => {
    const token = await login("knowledge-lifecycle@example.com");
    const workspaceId = await createWorkspace(token);
    const contents = Buffer.from("Knowledge text fixture\nwith Unicode: नमस्ते", "utf8");

    const upload = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/knowledge/upload`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", contents, { filename: "notes.txt", contentType: "text/plain" })
      .expect(201);
    const file = upload.body.data.file;
    expect(file).toMatchObject({
      workspaceId,
      originalName: "notes.txt",
      mimeType: "text/plain",
      fileSize: contents.length,
      status: "UPLOADED",
    });

    const listed = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/knowledge`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(listed.body.data.files.map((entry: { id: string }) => entry.id)).toContain(file.id);

    const fetched = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/knowledge/${file.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(fetched.body.data.file).toMatchObject({ id: file.id, originalName: "notes.txt" });

    const downloaded = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/knowledge/${file.id}/download`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(downloaded.text).toBe(contents.toString("utf8"));

    await request(app.getHttpServer())
      .delete(`/workspaces/${workspaceId}/knowledge/${file.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.deleted).toBe(true));
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/knowledge/${file.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("requires authentication for upload, list, get, and delete", async () => {
    const token = await login("knowledge-auth@example.com");
    const workspaceId = await createWorkspace(token);
    const route = `/workspaces/${workspaceId}/knowledge`;

    await request(app.getHttpServer()).post(`${route}/upload`).expect(401);
    await request(app.getHttpServer()).get(route).expect(401);
    await request(app.getHttpServer()).get(`${route}/missing-file`).expect(401);
    await request(app.getHttpServer()).delete(`${route}/missing-file`).expect(401);
  });

  it("does not expose files across workspace ownership boundaries", async () => {
    const ownerToken = await login("knowledge-owner@example.com");
    const otherToken = await login("knowledge-other@example.com");
    const workspaceId = await createWorkspace(ownerToken, "Private knowledge");
    const upload = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/knowledge/upload`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .attach("file", Buffer.from("owner only"), { filename: "private.txt", contentType: "text/plain" })
      .expect(201);
    const fileId = upload.body.data.file.id as string;

    for (const response of [
      await request(app.getHttpServer()).get(`/workspaces/${workspaceId}/knowledge`).set("Authorization", `Bearer ${otherToken}`).expect(404),
      await request(app.getHttpServer()).get(`/workspaces/${workspaceId}/knowledge/${fileId}`).set("Authorization", `Bearer ${otherToken}`).expect(404),
      await request(app.getHttpServer()).delete(`/workspaces/${workspaceId}/knowledge/${fileId}`).set("Authorization", `Bearer ${otherToken}`).expect(404),
    ]) {
      expect(response.body.error.code).toBe("WORKSPACE_NOT_FOUND");
    }

    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/knowledge/${fileId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
  });

  it("returns a stable not-found response for missing file metadata", async () => {
    const token = await login("knowledge-missing@example.com");
    const workspaceId = await createWorkspace(token);
    const route = `/workspaces/${workspaceId}/knowledge/missing-file`;

    const missingGet = await request(app.getHttpServer())
      .get(route)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
    const missingDelete = await request(app.getHttpServer())
      .delete(route)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
    expect(missingGet.body.error.code).toBe("KNOWLEDGE_FILE_NOT_FOUND");
    expect(missingDelete.body.error.code).toBe("KNOWLEDGE_FILE_NOT_FOUND");
  });

  it("rejects an authenticated upload request without a file with a client error", async () => {
    const token = await login("knowledge-empty-upload@example.com");
    const workspaceId = await createWorkspace(token);
    const response = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/knowledge/upload`)
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
    expect(response.body.error.code).toBe("KNOWLEDGE_FILE_REQUIRED");
  });
});
