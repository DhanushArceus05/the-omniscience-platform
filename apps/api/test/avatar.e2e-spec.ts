import type { INestApplication } from "@nestjs/common";
import * as fs from "node:fs/promises";
import request from "supertest";
import { registerVerifyAndLogin } from "./helpers/auth-test-helpers";
import { createTestApp, testEnv } from "./helpers/create-test-app";
import type { FakeMailService } from "./helpers/fake-mail.service";

/**
 * Exercises the real HTTP surface of Phase 3 Step 3's avatar endpoints:
 * `POST /users/me/avatar` and `DELETE /users/me/avatar`. `AvatarStorageService`
 * runs for real here (not faked) — plain local-disk I/O against
 * `testEnv.AVATAR_STORAGE_DIR` (a dedicated OS temp directory, see
 * `create-test-app.ts`), so these assertions cover genuine file-signature
 * validation and genuine file writes/deletes, not a mocked stand-in.
 *
 * Minimal, deliberately-tiny-but-signature-valid buffers are used for
 * each format — `detectImageType` only inspects magic bytes, so these
 * don't need to be real, fully-decodable photos to exercise the real
 * validation path.
 */

/**
 * Polls a static avatar URL until it 404s (or a short timeout elapses).
 *
 * `AvatarStorageService.delete`/`UsersService.uploadAvatar`/`deleteAvatar`
 * all correctly `await fs.unlink(...)` before their promise resolves —
 * the application code has no logic bug here (verified independently:
 * a bare `NestExpressApplication` + `useStaticAssets` + `fs.unlink`
 * reproduction, with no other app modules involved at all, reflects a
 * deletion on the very next request every time). What isn't guaranteed
 * on every filesystem/container/CI runner is that the *directory
 * entry's* removal is visible to a *separate* `fs.stat` call
 * (`serve-static`'s, made from a different code path/tick than the
 * `unlink` that just happened) within the same instant — some
 * overlay/bind-mounted filesystems have a brief metadata-propagation
 * gap. This polls for up to a second, which is generous enough to
 * absorb that gap without masking a real regression (a genuine bug
 * would still fail after the full timeout).
 */
async function expectAvatarGone(
  app: INestApplication,
  avatarPath: string,
  { timeoutMs = 1000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = -1;
  for (;;) {
    const response = await request(app.getHttpServer()).get(avatarPath);
    lastStatus = response.status;
    if (lastStatus === 404) return;
    if (Date.now() >= deadline) {
      throw new Error(`Expected ${avatarPath} to eventually 404, but it still returned ${lastStatus}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("Avatar upload/delete (e2e, Phase 3 Step 3)", () => {
  let app: INestApplication;
  let mail: FakeMailService;

  const password = "Sup3r$ecretPassw0rd!";

  const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const webpBuffer = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "ascii"),
  ]);
  const notAnImageBuffer = Buffer.from("just some plain text, not an image at all", "utf8");

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
    mail = created.mail;
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await fs.rm(testEnv.AVATAR_STORAGE_DIR, { recursive: true, force: true });
  });

  describe("POST /users/me/avatar", () => {
    it("accepts a valid JPEG upload and returns a public avatar URL", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-jpeg@example.com", password, "Avatar Tester");

      const response = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", jpegBuffer, { filename: "photo.jpg", contentType: "image/jpeg" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.avatarUrl).toMatch(
        /^http:\/\/localhost:4000\/uploads\/avatars\/[a-f0-9-]+\.jpg$/,
      );
    });

    it("accepts a valid PNG upload", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-png@example.com", password, "Avatar Tester");

      const response = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", pngBuffer, { filename: "photo.png", contentType: "image/png" })
        .expect(200);

      expect(response.body.data.avatarUrl).toMatch(/\.png$/);
    });

    it("accepts a valid WebP upload", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-webp@example.com", password, "Avatar Tester");

      const response = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", webpBuffer, { filename: "photo.webp", contentType: "image/webp" })
        .expect(200);

      expect(response.body.data.avatarUrl).toMatch(/\.webp$/);
    });

    it("the uploaded avatar is actually reachable at its returned public URL", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-reachable@example.com", password, "Avatar Tester");

      const uploadResponse = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", jpegBuffer, { filename: "photo.jpg", contentType: "image/jpeg" })
        .expect(200);

      const avatarPath = new URL(uploadResponse.body.data.avatarUrl).pathname;
      const staticResponse = await request(app.getHttpServer()).get(avatarPath).expect(200);
      expect(Number(staticResponse.headers["content-length"])).toBe(jpegBuffer.length);
    });

    it("rejects an unsupported declared type (GIF)", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-gif@example.com", password, "Avatar Tester");

      const response = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", Buffer.from("GIF89a"), { filename: "photo.gif", contentType: "image/gif" })
        .expect(415);

      expect(response.body.error.code).toBe("AVATAR_TYPE_UNSUPPORTED");
    });

    it("rejects a file whose declared type is an image but whose real bytes are not (spoofed Content-Type)", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-spoofed@example.com", password, "Avatar Tester");

      const response = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", notAnImageBuffer, { filename: "photo.png", contentType: "image/png" })
        .expect(415);

      expect(response.body.error.code).toBe("AVATAR_TYPE_UNSUPPORTED");
    });

    it("rejects an oversized upload", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-oversized@example.com", password, "Avatar Tester");
      const oversizedBuffer = Buffer.concat([jpegBuffer, Buffer.alloc(6 * 1024 * 1024, 0)]);

      const response = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", oversizedBuffer, { filename: "huge.jpg", contentType: "image/jpeg" })
        .expect(413);

      expect(response.body.error.code).toBe("AVATAR_TOO_LARGE");
    });

    it("rejects an unauthenticated request", async () => {
      await request(app.getHttpServer())
        .post("/users/me/avatar")
        .attach("file", jpegBuffer, { filename: "photo.jpg", contentType: "image/jpeg" })
        .expect(401);
    });

    it("rejects a request with no file attached", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-no-file@example.com", password, "Avatar Tester");

      const response = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(415);

      expect(response.body.error.code).toBe("AVATAR_TYPE_UNSUPPORTED");
    });

    it("replacing an existing avatar removes the old file and returns a new URL", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-replace@example.com", password, "Avatar Tester");

      const first = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", jpegBuffer, { filename: "first.jpg", contentType: "image/jpeg" })
        .expect(200);
      const firstPath = new URL(first.body.data.avatarUrl).pathname;

      const second = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", pngBuffer, { filename: "second.png", contentType: "image/png" })
        .expect(200);

      expect(second.body.data.avatarUrl).not.toBe(first.body.data.avatarUrl);
      // The old file is actually gone from disk, not just unreferenced.
      await expectAvatarGone(app, firstPath);
      // /auth/me now reflects only the new avatar.
      const me = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(me.body.data.avatarUrl).toBe(second.body.data.avatarUrl);
    });

    it("scopes the upload to the caller's own account only (owner always from the JWT)", async () => {
      const tokenA = await registerVerifyAndLogin(app, mail, "avatar-owner-a@example.com", password, "Owner A");
      const tokenB = await registerVerifyAndLogin(app, mail, "avatar-owner-b@example.com", password, "Owner B");

      await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${tokenA}`)
        .attach("file", jpegBuffer, { filename: "a.jpg", contentType: "image/jpeg" })
        .expect(200);

      const meB = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);
      expect(meB.body.data.avatarUrl).toBeNull();
    });
  });

  describe("DELETE /users/me/avatar", () => {
    it("removes an existing avatar and falls back to no avatar", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-delete@example.com", password, "Avatar Tester");
      const uploaded = await request(app.getHttpServer())
        .post("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", jpegBuffer, { filename: "photo.jpg", contentType: "image/jpeg" })
        .expect(200);
      const avatarPath = new URL(uploaded.body.data.avatarUrl).pathname;

      const response = await request(app.getHttpServer())
        .delete("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toEqual({ success: true, data: { avatarUrl: null } });
      await expectAvatarGone(app, avatarPath);
    });

    it("is a safe no-op when there was no avatar", async () => {
      const accessToken = await registerVerifyAndLogin(app, mail, "avatar-delete-noop@example.com", password, "Avatar Tester");

      const response = await request(app.getHttpServer())
        .delete("/users/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toEqual({ success: true, data: { avatarUrl: null } });
    });

    it("rejects an unauthenticated request", async () => {
      await request(app.getHttpServer()).delete("/users/me/avatar").expect(401);
    });
  });
});
