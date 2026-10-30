import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { KnowledgeStorageService } from "./knowledge-storage.service";

const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const DOCX_BYTES = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00,
]); // PK.. (ZIP header, DOCX is a ZIP)
const TXT_BYTES = Buffer.from("Sample text content", "utf8");

describe("KnowledgeStorageService", () => {
  let storageDir: string;
  let service: KnowledgeStorageService;

  beforeEach(async () => {
    storageDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "omniscience-knowledge-test-"),
    );
    const env = {
      KNOWLEDGE_STORAGE_DIR: storageDir,
      KNOWLEDGE_FILE_SIZE_LIMIT_MB: 1, // small on purpose (1MB)
    } as unknown as Env;
    service = new KnowledgeStorageService(env);
  });

  afterEach(async () => {
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  describe("save", () => {
    it("saves a valid PDF and returns storage key, checksum, and fileSize", async () => {
      const result = await service.save({
        buffer: PDF_BYTES,
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
      });

      expect(result.storageKey).toMatch(/^[a-f0-9-]+\.pdf$/);
      expect(result.checksum).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
      expect(result.fileSize).toBe(PDF_BYTES.length);

      const written = await fs.readFile(path.join(storageDir, result.storageKey));
      expect(written.equals(PDF_BYTES)).toBe(true);
    });

    it("saves a valid DOCX with .docx extension", async () => {
      const result = await service.save({
        buffer: DOCX_BYTES,
        originalname: "test.docx",
        mimetype:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: DOCX_BYTES.length,
      });
      expect(result.storageKey).toMatch(/\.docx$/);
    });

    it("saves a valid TXT with .txt extension", async () => {
      const result = await service.save({
        buffer: TXT_BYTES,
        originalname: "test.txt",
        mimetype: "text/plain",
        size: TXT_BYTES.length,
      });
      expect(result.storageKey).toMatch(/\.txt$/);
    });

    it("rejects an oversized upload with KNOWLEDGE_FILE_TOO_LARGE", async () => {
      const big = Buffer.alloc(2 * 1024 * 1024); // 2MB, over the 1MB limit
      await expect(
        service.save({
          buffer: big,
          originalname: "big.pdf",
          mimetype: "application/pdf",
          size: big.length,
        }),
      ).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_TOO_LARGE" } });
      await expect(
        service.save({
          buffer: big,
          originalname: "big.pdf",
          mimetype: "application/pdf",
          size: big.length,
        }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });

    it("rejects an unsupported declared mimetype (e.g. application/zip)", async () => {
      await expect(
        service.save({
          buffer: PDF_BYTES,
          originalname: "test.zip",
          mimetype: "application/zip",
          size: PDF_BYTES.length,
        }),
      ).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_TYPE_UNSUPPORTED" } });
      await expect(
        service.save({
          buffer: PDF_BYTES,
          originalname: "test.zip",
          mimetype: "application/zip",
          size: PDF_BYTES.length,
        }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    });

    it("rejects a file without an extension", async () => {
      await expect(
        service.save({
          buffer: PDF_BYTES,
          originalname: "test",
          mimetype: "application/pdf",
          size: PDF_BYTES.length,
        }),
      ).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_NO_EXTENSION" } });
      await expect(
        service.save({
          buffer: PDF_BYTES,
          originalname: "test",
          mimetype: "application/pdf",
          size: PDF_BYTES.length,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a file with wrong extension even if MIME type is correct", async () => {
      await expect(
        service.save({
          buffer: PDF_BYTES,
          originalname: "test.exe",
          mimetype: "application/pdf",
          size: PDF_BYTES.length,
        }),
      ).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_TYPE_UNSUPPORTED" } });
    });

    it("rejects MIME and extension pairs that do not describe the same format", async () => {
      await expect(service.save({
        buffer: PDF_BYTES,
        originalname: "test.txt",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
      })).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_TYPE_MISMATCH" } });
      await expect(service.save({
        buffer: TXT_BYTES,
        originalname: "test.pdf",
        mimetype: "text/plain",
        size: TXT_BYTES.length,
      })).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_TYPE_MISMATCH" } });
    });

    it("rejects incorrect PDF and DOCX content signatures", async () => {
      await expect(service.save({
        buffer: TXT_BYTES,
        originalname: "fake.pdf",
        mimetype: "application/pdf",
        size: TXT_BYTES.length,
      })).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_CONTENT_MISMATCH" } });
      await expect(service.save({
        buffer: TXT_BYTES,
        originalname: "fake.docx",
        mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: TXT_BYTES.length,
      })).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_CONTENT_MISMATCH" } });
    });

    it("rejects a reported size that differs from the actual buffer length", async () => {
      await expect(service.save({
        buffer: PDF_BYTES,
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: PDF_BYTES.length + 1,
      })).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_SIZE_MISMATCH" } });
    });

    it("enforces the configured limit against actual bytes even when reported size is smaller", async () => {
      const tooLarge = Buffer.concat([PDF_BYTES, Buffer.alloc(1024 * 1024)]);
      await expect(service.save({
        buffer: tooLarge,
        originalname: "large.pdf",
        mimetype: "application/pdf",
        size: tooLarge.length,
      })).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_TOO_LARGE" } });
    });

    it("rejects malformed UTF-8 text at upload validation", async () => {
      const invalid = Buffer.from([0xc3, 0x28]);
      await expect(service.save({
        buffer: invalid,
        originalname: "invalid.txt",
        mimetype: "text/plain",
        size: invalid.length,
      })).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_ENCODING_INVALID" } });
    });

    it("creates the storage directory on first use if it doesn't exist yet", async () => {
      await fs.rm(storageDir, { recursive: true, force: true });
      const result = await service.save({
        buffer: PDF_BYTES,
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
      });
      const written = await fs.readFile(path.join(storageDir, result.storageKey));
      expect(written.length).toBe(PDF_BYTES.length);
    });

    it("generates a different storage key for every save (no filename collisions)", async () => {
      const first = await service.save({
        buffer: PDF_BYTES,
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
      });
      const second = await service.save({
        buffer: PDF_BYTES,
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
      });
      expect(first.storageKey).not.toBe(second.storageKey);
    });

    it("computes consistent checksums for identical content", async () => {
      const first = await service.save({
        buffer: PDF_BYTES,
        originalname: "test1.pdf",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
      });
      const second = await service.save({
        buffer: PDF_BYTES,
        originalname: "test2.pdf",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
      });
      expect(first.checksum).toBe(second.checksum);
    });

    it("computes different checksums for different content", async () => {
      const first = await service.save({
        buffer: PDF_BYTES,
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
      });
      const different = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00]);
      const second = await service.save({
        buffer: different,
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: different.length,
      });
      expect(first.checksum).not.toBe(second.checksum);
    });
  });

  describe("read", () => {
    it("reads a previously saved file", async () => {
      const { storageKey } = await service.save({
        buffer: PDF_BYTES,
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
      });
      const read = await service.read(storageKey);
      expect(read.equals(PDF_BYTES)).toBe(true);
    });

    it("throws for a missing file", async () => {
      await expect(
        service.read("11111111-1111-1111-1111-111111111111.pdf"),
      ).rejects.toThrow();
    });

    it("rejects a storage key containing a path traversal attempt", async () => {
      await expect(service.read("../../etc/passwd")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe("delete", () => {
    it("deletes a previously saved file", async () => {
      const { storageKey } = await service.save({
        buffer: PDF_BYTES,
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
      });
      await service.delete(storageKey);
      await expect(fs.readFile(path.join(storageDir, storageKey))).rejects.toThrow();
    });

    it("is a no-op (does not throw) for null/undefined", async () => {
      await expect(service.delete(null)).resolves.toBeUndefined();
      await expect(service.delete(undefined)).resolves.toBeUndefined();
    });

    it("is a no-op (does not throw) for an already-missing file", async () => {
      await expect(
        service.delete("11111111-1111-1111-1111-111111111111.pdf"),
      ).resolves.toBeUndefined();
    });

    it("rejects a storage key containing a path traversal attempt without touching the filesystem outside storageDir", async () => {
      await expect(service.delete("../../etc/passwd")).resolves.toBeUndefined();
    });
  });

  describe("sanitizeFilename", () => {
    it("removes directory paths from filenames", () => {
      expect(service.sanitizeFilename("../../etc/passwd.txt")).toBe("passwd.txt");
      expect(service.sanitizeFilename("/etc/passwd.txt")).toBe("passwd.txt");
      expect(service.sanitizeFilename("C:\\Windows\\System32\\file.txt")).toBe("file.txt");
    });

    it("replaces special characters with underscores", () => {
      expect(service.sanitizeFilename("file@#$%.pdf")).toBe("file____.pdf");
      expect(service.sanitizeFilename("file with spaces.txt")).toBe(
        "file_with_spaces.txt",
      );
    });

    it("preserves safe characters (alphanumeric, dot, underscore, hyphen)", () => {
      expect(service.sanitizeFilename("My-File_2024.v1.pdf")).toBe(
        "My-File_2024.v1.pdf",
      );
    });
  });

  describe("getMaxUploadBytes", () => {
    it("returns the configured cap in bytes", () => {
      expect(service.getMaxUploadBytes()).toBe(1 * 1024 * 1024); // 1MB
    });
  });
});
