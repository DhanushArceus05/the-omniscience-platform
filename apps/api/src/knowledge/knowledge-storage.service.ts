import { createHash, randomUUID } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import * as path from "node:path";
import { TextDecoder } from "node:util";
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { ALLOWED_KNOWLEDGE_EXTENSIONS, ALLOWED_KNOWLEDGE_MIME_TYPES } from "@omniscience/schemas";
import { ENV } from "../config/config.constants";

export interface KnowledgeFileUploadInput {
  /** The already-buffered file contents (Multer's memory storage). */
  buffer: Buffer;
  /** The client's original filename — used for extension validation, never as-is for storage. */
  originalname: string;
  /** The client-declared `Content-Type` — checked, but never trusted alone. */
  mimetype: string;
  /** The buffer's byte length, checked against the configured cap. */
  size: number;
}

export interface StoredKnowledgeFile {
  /** Safe, randomly-generated storage key. Persisted as `KnowledgeFile.storageKey`. */
  storageKey: string;
  /** SHA-256 checksum of the file contents. */
  checksum: string;
  /** The file size in bytes. */
  fileSize: number;
}

const SAFE_STORAGE_KEY_PATTERN = /^[a-f0-9-]+\.(pdf|docx|txt)$/;
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};

/**
 * Phase 7 Step 1 — knowledge file storage.
 *
 * MVP strategy: local disk, under `KNOWLEDGE_STORAGE_DIR`, following the
 * same pattern as `AvatarStorageService`. This service is deliberately
 * narrow (`save`/`delete`/`read`) so a future step can swap in object
 * storage (S3-compatible) without changing any caller.
 *
 * Every validation rule the approved Step 1 scope requires is enforced:
 * - Size cap (`KNOWLEDGE_FILE_SIZE_LIMIT_MB`, default 25MB) — this is
 *   the *authoritative* check; Multer's `limits.fileSize` is only a DoS
 *   backstop during upload streaming.
 * - Client-declared MIME type must be PDF/DOCX/TXT.
 * - File extension must also match one of those three formats — a
 *   spoofed `Content-Type` alone is never enough.
 * - Storage keys are always `${randomUUID()}.<ext>` — never derived from
 *   the client's original filename, preventing path-traversal.
 * - SHA-256 checksum computed for integrity verification.
 * - Filename sanitization to prevent special characters or path separators.
 */
@Injectable()
export class KnowledgeStorageService {
  private readonly storageDir: string;
  private readonly maxUploadBytes: number;
  private readonly pendingStorageKeys = new Set<string>();

  constructor(@Inject(ENV) env: Env) {
    this.storageDir = path.resolve(env.KNOWLEDGE_STORAGE_DIR);
    this.maxUploadBytes = env.KNOWLEDGE_FILE_SIZE_LIMIT_MB * 1024 * 1024;
  }

  getMaxUploadBytes(): number {
    return this.maxUploadBytes;
  }

  /**
   * Validates and writes a new knowledge file, returning its storage key
   * and checksum. Callers (`KnowledgeService`) are responsible for
   * creating the `KnowledgeFile` database record.
   */
  async save(input: KnowledgeFileUploadInput): Promise<StoredKnowledgeFile> {
    this.assertValid(input);

    const extension = this.extractExtension(input.originalname);
    const checksum = this.computeChecksum(input.buffer);

    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      const storageKey = `${randomUUID()}${extension}`;
      this.pendingStorageKeys.add(storageKey);
      try {
        await fs.writeFile(this.resolveSafePath(storageKey), input.buffer, { mode: 0o600 });
      } catch (error) {
        this.pendingStorageKeys.delete(storageKey);
        throw error;
      }
      return { storageKey, checksum, fileSize: input.buffer.length };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnsupportedMediaTypeException ||
        error instanceof PayloadTooLargeException
      ) {
        throw error;
      }
      throw new InternalServerErrorException({
        code: "KNOWLEDGE_STORAGE_ERROR",
        message: "The file could not be saved. Please try again.",
      });
    }
  }

  /** Mark a successfully persisted file record as no longer in-flight. */
  markCommitted(storageKey: string): void {
    this.pendingStorageKeys.delete(storageKey);
  }

  /** Release an upload after its metadata write failed; reconciliation removes it after a grace period. */
  releasePending(storageKey: string): void {
    this.pendingStorageKeys.delete(storageKey);
  }

  /** Return only old, generated storage files; callers must cross-check every key against metadata. */
  async listStaleFiles(cutoff: Date): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.storageDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new InternalServerErrorException({
        code: "KNOWLEDGE_STORAGE_ERROR",
        message: "Stored files could not be inspected.",
      });
    }

    const stale: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !SAFE_STORAGE_KEY_PATTERN.test(entry.name) || this.pendingStorageKeys.has(entry.name)) {
        continue;
      }
      try {
        const stat = await fs.stat(this.resolveSafePath(entry.name));
        if (stat.mtime <= cutoff) stale.push(entry.name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return stale;
  }

  /**
   * Reads a stored knowledge file by its storage key.
   * Returns the file buffer, or throws if the file doesn't exist.
   */
  async read(storageKey: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolveSafePath(storageKey));
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException({
        code: "KNOWLEDGE_STORAGE_ERROR",
        message: "The file could not be read.",
      });
    }
  }

  /**
   * Best-effort delete of a previously-stored knowledge file.
   * A missing file is not an error — `fs.rm(..., { force: true })` is
   * idempotent. A storage key that fails format validation is also
   * treated as a no-op (no file to remove).
   */
  async delete(storageKey: string | null | undefined): Promise<void> {
    if (!storageKey) return;
    try {
      await fs.rm(this.resolveSafePath(storageKey), { force: true });
    } catch (error) {
      if (error instanceof BadRequestException) return;
      throw new InternalServerErrorException({
        code: "KNOWLEDGE_STORAGE_ERROR",
        message: "The file could not be removed.",
      });
    }
  }

  /**
   * Sanitizes a user-provided filename to prevent path traversal and
   * special characters. Used when returning the original filename to the
   * client (e.g., for download headers).
   */
  sanitizeFilename(filename: string): string {
    // Normalize both Windows and Unix separators before extracting the basename.
    const base = path.basename(filename.replace(/\\/gu, "/"));
    // Replace any remaining problematic characters with underscores
    return base.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private assertValid(input: KnowledgeFileUploadInput): void {
    // The buffer is authoritative; Multer's reported size is only cross-checked.
    if (input.buffer.length > this.maxUploadBytes) {
      throw new PayloadTooLargeException({
        code: "KNOWLEDGE_FILE_TOO_LARGE",
        message: `The file must be ${Math.floor(this.maxUploadBytes / (1024 * 1024))}MB or smaller.`,
      });
    }
    if (!Number.isSafeInteger(input.size) || input.size !== input.buffer.length) {
      throw new BadRequestException({
        code: "KNOWLEDGE_FILE_SIZE_MISMATCH",
        message: "The uploaded file size is invalid.",
      });
    }

    // MIME type check
    const extension = this.extractExtension(input.originalname);
    const allowedMimeTypes: readonly string[] = ALLOWED_KNOWLEDGE_MIME_TYPES;
    const allowedExtensions: readonly string[] = ALLOWED_KNOWLEDGE_EXTENSIONS;
    if (!allowedMimeTypes.includes(input.mimetype) || !allowedExtensions.includes(extension)) {
      throw new UnsupportedMediaTypeException({
        code: "KNOWLEDGE_FILE_TYPE_UNSUPPORTED",
        message: "File must be PDF, DOCX, or TXT.",
      });
    }

    if (MIME_BY_EXTENSION[extension] !== input.mimetype) {
      throw new UnsupportedMediaTypeException({
        code: "KNOWLEDGE_FILE_TYPE_MISMATCH",
        message: "The file extension does not match its declared type.",
      });
    }

    if (extension === ".pdf" && input.buffer.subarray(0, 1024).indexOf("%PDF-") < 0) {
      throw this.contentMismatch();
    }
    if (extension === ".docx" && (input.buffer.length < 4 || input.buffer.readUInt32LE(0) !== 0x04034b50)) {
      throw this.contentMismatch();
    }
    if (extension === ".txt") {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(input.buffer);
      } catch {
        throw new BadRequestException({
          code: "KNOWLEDGE_FILE_ENCODING_INVALID",
          message: "The text file must contain valid UTF-8 encoding.",
        });
      }
    }
  }

  private contentMismatch(): UnsupportedMediaTypeException {
    return new UnsupportedMediaTypeException({
      code: "KNOWLEDGE_FILE_CONTENT_MISMATCH",
      message: "The file contents do not match the declared file type.",
    });
  }

  private extractExtension(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    if (!ext) {
      throw new BadRequestException({
        code: "KNOWLEDGE_FILE_NO_EXTENSION",
        message: "File must have a valid extension (.pdf, .docx, or .txt).",
      });
    }
    return ext;
  }

  private computeChecksum(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Storage keys only ever come from `save()`'s own `randomUUID()`
   * output, but every path built from one is re-validated here anyway
   * (defense in depth) — never allowing path separators or `..` to
   * escape `storageDir`.
   */
  private resolveSafePath(storageKey: string): string {
    if (!SAFE_STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new BadRequestException({
        code: "INVALID_KNOWLEDGE_FILE_KEY",
        message: "Invalid file reference.",
      });
    }
    return path.join(this.storageDir, storageKey);
  }
}
