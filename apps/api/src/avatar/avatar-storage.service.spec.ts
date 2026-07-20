import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { AvatarStorageService } from "./avatar-storage.service";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x00]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const NOT_AN_IMAGE = Buffer.from("just some plain text, not an image", "utf8");

describe("AvatarStorageService", () => {
  let storageDir: string;
  let service: AvatarStorageService;

  beforeEach(async () => {
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "omniscience-avatar-test-"));
    const env = {
      AVATAR_STORAGE_DIR: storageDir,
      AVATAR_PUBLIC_BASE_URL: "http://localhost:4000",
      AVATAR_MAX_UPLOAD_BYTES: 1024, // small on purpose, so oversized tests stay tiny
    } as unknown as Env;
    service = new AvatarStorageService(env);
  });

  afterEach(async () => {
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  describe("save", () => {
    it("saves a valid JPEG and returns a generated storage key + public URL", async () => {
      const result = await service.save({
        buffer: JPEG_BYTES,
        mimetype: "image/jpeg",
        size: JPEG_BYTES.length,
      });

      expect(result.storageKey).toMatch(/^[a-f0-9-]+\.jpg$/);
      expect(result.publicUrl).toBe(`http://localhost:4000/uploads/avatars/${result.storageKey}`);
      const written = await fs.readFile(path.join(storageDir, result.storageKey));
      expect(written.equals(JPEG_BYTES)).toBe(true);
    });

    it("saves a valid PNG with a .png storage key", async () => {
      const result = await service.save({
        buffer: PNG_BYTES,
        mimetype: "image/png",
        size: PNG_BYTES.length,
      });
      expect(result.storageKey).toMatch(/\.png$/);
    });

    it("rejects an oversized upload with AVATAR_TOO_LARGE", async () => {
      const big = Buffer.concat([JPEG_BYTES, Buffer.alloc(2000)]);
      await expect(
        service.save({ buffer: big, mimetype: "image/jpeg", size: big.length }),
      ).rejects.toMatchObject({ response: { code: "AVATAR_TOO_LARGE" } });
      await expect(
        service.save({ buffer: big, mimetype: "image/jpeg", size: big.length }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });

    it("rejects an unsupported declared mimetype (e.g. image/gif)", async () => {
      await expect(
        service.save({ buffer: JPEG_BYTES, mimetype: "image/gif", size: JPEG_BYTES.length }),
      ).rejects.toMatchObject({ response: { code: "AVATAR_TYPE_UNSUPPORTED" } });
    });

    it("rejects a declared image/png mimetype whose real bytes are not an image (spoofed Content-Type)", async () => {
      await expect(
        service.save({ buffer: NOT_AN_IMAGE, mimetype: "image/png", size: NOT_AN_IMAGE.length }),
      ).rejects.toMatchObject({ response: { code: "AVATAR_TYPE_UNSUPPORTED" } });
      await expect(
        service.save({ buffer: NOT_AN_IMAGE, mimetype: "image/png", size: NOT_AN_IMAGE.length }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    });

    it("rejects SVG outright, even declared as an allowed type", async () => {
      const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="x"></svg>', "utf8");
      await expect(
        service.save({ buffer: svg, mimetype: "image/svg+xml", size: svg.length }),
      ).rejects.toMatchObject({ response: { code: "AVATAR_TYPE_UNSUPPORTED" } });
    });

    it("creates the storage directory on first use if it doesn't exist yet", async () => {
      await fs.rm(storageDir, { recursive: true, force: true });
      const result = await service.save({
        buffer: JPEG_BYTES,
        mimetype: "image/jpeg",
        size: JPEG_BYTES.length,
      });
      const written = await fs.readFile(path.join(storageDir, result.storageKey));
      expect(written.length).toBe(JPEG_BYTES.length);
    });

    it("generates a different storage key for every save (no filename collisions)", async () => {
      const first = await service.save({
        buffer: JPEG_BYTES,
        mimetype: "image/jpeg",
        size: JPEG_BYTES.length,
      });
      const second = await service.save({
        buffer: JPEG_BYTES,
        mimetype: "image/jpeg",
        size: JPEG_BYTES.length,
      });
      expect(first.storageKey).not.toBe(second.storageKey);
    });
  });

  describe("delete", () => {
    it("deletes a previously saved avatar", async () => {
      const { storageKey } = await service.save({
        buffer: JPEG_BYTES,
        mimetype: "image/jpeg",
        size: JPEG_BYTES.length,
      });
      await service.delete(storageKey);
      await expect(fs.readFile(path.join(storageDir, storageKey))).rejects.toThrow();
    });

    it("is a no-op (does not throw) for null/undefined", async () => {
      await expect(service.delete(null)).resolves.toBeUndefined();
      await expect(service.delete(undefined)).resolves.toBeUndefined();
    });

    it("is a no-op (does not throw) for an already-missing file", async () => {
      await expect(service.delete("11111111-1111-1111-1111-111111111111.jpg")).resolves.toBeUndefined();
    });

    it("rejects a storage key containing a path traversal attempt without touching the filesystem outside storageDir", async () => {
      await expect(service.delete("../../etc/passwd")).resolves.toBeUndefined();
    });
  });

  describe("buildPublicUrl", () => {
    it("builds an absolute URL under the configured public base", () => {
      expect(service.buildPublicUrl("abc.png")).toBe(
        "http://localhost:4000/uploads/avatars/abc.png",
      );
    });

    it("strips a trailing slash from the configured base URL", () => {
      const withTrailingSlash = new AvatarStorageService({
        AVATAR_STORAGE_DIR: storageDir,
        AVATAR_PUBLIC_BASE_URL: "http://localhost:4000/",
        AVATAR_MAX_UPLOAD_BYTES: 1024,
      } as unknown as Env);
      expect(withTrailingSlash.buildPublicUrl("abc.png")).toBe(
        "http://localhost:4000/uploads/avatars/abc.png",
      );
    });
  });

  describe("getMaxUploadBytes", () => {
    it("returns the configured cap", () => {
      expect(service.getMaxUploadBytes()).toBe(1024);
    });
  });
});
