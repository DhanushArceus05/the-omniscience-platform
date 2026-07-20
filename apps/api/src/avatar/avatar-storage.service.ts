import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { ENV } from "../config/config.constants";
import {
  detectImageType,
  extensionForImageType,
  isAllowedAvatarMimeType,
} from "./image-signature";

export interface AvatarUploadInput {
  /** The already-buffered file contents (Multer's memory storage). */
  buffer: Buffer;
  /** The client-declared `Content-Type` — checked, but never trusted alone; see `assertValid`. */
  mimetype: string;
  /** The buffer's byte length, checked against the configured cap. */
  size: number;
}

export interface StoredAvatar {
  /** Safe, randomly-generated filename — never derived from client input. Persisted as `User.avatarStorageKey`. */
  storageKey: string;
  /** The absolute, publicly-reachable URL for this avatar. Computed, never persisted (see the Prisma schema's docstring on why). */
  publicUrl: string;
}

const SAFE_STORAGE_KEY_PATTERN = /^[a-f0-9-]+\.(jpg|png|webp)$/;

/**
 * Phase 3 Step 3 — avatar storage.
 *
 * MVP strategy: local disk, under `AVATAR_STORAGE_DIR`, served back out
 * as static files by the API itself (`main.ts` mounts
 * `AVATAR_STORAGE_DIR` at the `/uploads/avatars` static prefix). This
 * repo has no pre-existing pluggable object-storage abstraction to
 * reuse (the `.env.example` `OBJECT_STORAGE_*` variables are unused
 * placeholders from an earlier phase) — this service is deliberately
 * the first one, kept small and behind a narrow interface
 * (`save`/`delete`/`buildPublicUrl`) so a future step can swap in a
 * real object-storage backend (S3-compatible or otherwise) without any
 * caller (`UsersService`, `UsersController`) needing to change.
 *
 * Every validation rule the approved Step 3 scope requires is enforced
 * here, not just at the HTTP layer, so it's exercised by focused unit
 * tests independent of any HTTP/Multer plumbing:
 * - Size cap (`AVATAR_MAX_UPLOAD_BYTES`, default 5MB) — this is the
 *   *authoritative* check; Multer's own `limits.fileSize` (a fixed
 *   constant configured inline on `UsersController.uploadAvatar`'s
 *   `FileInterceptor`) is only a generous DoS backstop during upload
 *   streaming, not the source of truth for the exact business rule.
 * - Client-declared MIME type must be JPEG/PNG/WebP.
 * - The file's actual magic bytes (`detectImageType`) must *also*
 *   match one of those three formats — a spoofed `Content-Type` alone
 *   is never enough. No SVG, ever (see `image-signature.ts`'s
 *   docstring for why).
 * - Storage keys are always `${randomUUID()}.<ext>` — never derived
 *   from the client's original filename, so there is no path-traversal
 *   or filename-collision surface.
 */
@Injectable()
export class AvatarStorageService {
  private readonly storageDir: string;
  private readonly publicBaseUrl: string;
  private readonly maxUploadBytes: number;

  constructor(@Inject(ENV) env: Env) {
    this.storageDir = path.resolve(env.AVATAR_STORAGE_DIR);
    this.publicBaseUrl = env.AVATAR_PUBLIC_BASE_URL.replace(/\/+$/, "");
    this.maxUploadBytes = env.AVATAR_MAX_UPLOAD_BYTES;
  }

  getMaxUploadBytes(): number {
    return this.maxUploadBytes;
  }

  /**
   * Validates and writes a new avatar file, returning its storage key
   * and public URL. Callers (`UsersService`) are responsible for
   * updating `User.avatarStorageKey` and deleting whatever the
   * previous key was — this method only ever adds a new file, it never
   * knows or cares whether it's a first upload or a replacement.
   */
  async save(input: AvatarUploadInput): Promise<StoredAvatar> {
    this.assertValid(input);
    const detected = detectImageType(input.buffer);
    // `assertValid` already guarantees this is non-null; re-checked here
    // only so TypeScript can narrow it without a non-null assertion.
    if (!detected) {
      throw new UnsupportedMediaTypeException({
        code: "AVATAR_TYPE_UNSUPPORTED",
        message: "The uploaded file is not a valid JPEG, PNG, or WebP image.",
      });
    }

    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      const storageKey = `${randomUUID()}.${extensionForImageType(detected)}`;
      await fs.writeFile(this.resolveSafePath(storageKey), input.buffer, { mode: 0o600 });
      return { storageKey, publicUrl: this.buildPublicUrl(storageKey) };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof UnsupportedMediaTypeException) {
        throw error;
      }
      throw new InternalServerErrorException({
        code: "AVATAR_STORAGE_ERROR",
        message: "The avatar could not be saved. Please try again.",
      });
    }
  }

  /**
   * Best-effort delete of a previously-stored avatar (replacing or
   * removing one). A missing file (`ENOENT` — already gone, or never
   * existed) is not an error; anything else surfaces as a clear,
   * structured failure rather than a silent no-op or a raw filesystem
   * error/path leaking to the client.
   */
  async delete(storageKey: string | null | undefined): Promise<void> {
    if (!storageKey) return;
    try {
      await fs.unlink(this.resolveSafePath(storageKey));
    } catch (error) {
      if (error instanceof BadRequestException) {
        // An invalid key can't correspond to a real file on disk anyway
        // (see `resolveSafePath`) — treat exactly like "already gone".
        return;
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw new InternalServerErrorException({
        code: "AVATAR_STORAGE_ERROR",
        message: "The previous avatar could not be removed.",
      });
    }
  }

  buildPublicUrl(storageKey: string): string {
    return `${this.publicBaseUrl}/uploads/avatars/${storageKey}`;
  }

  private assertValid(input: AvatarUploadInput): void {
    if (input.size > this.maxUploadBytes) {
      throw new PayloadTooLargeException({
        code: "AVATAR_TOO_LARGE",
        message: `The avatar must be ${Math.floor(this.maxUploadBytes / (1024 * 1024))}MB or smaller.`,
      });
    }
    if (!isAllowedAvatarMimeType(input.mimetype)) {
      throw new UnsupportedMediaTypeException({
        code: "AVATAR_TYPE_UNSUPPORTED",
        message: "Avatar must be a JPEG, PNG, or WebP image.",
      });
    }
    if (!detectImageType(input.buffer)) {
      throw new UnsupportedMediaTypeException({
        code: "AVATAR_TYPE_UNSUPPORTED",
        message: "The uploaded file is not a valid JPEG, PNG, or WebP image.",
      });
    }
  }

  /**
   * Storage keys only ever come from `save()`'s own `randomUUID()`
   * output, but every path built from one is re-validated here anyway
   * (defense in depth against a future caller passing an
   * unsanitized/attacker-influenced value) — never allowing a path
   * separator or `..` to escape `storageDir`.
   */
  private resolveSafePath(storageKey: string): string {
    if (!SAFE_STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new BadRequestException({
        code: "INVALID_AVATAR_KEY",
        message: "Invalid avatar reference.",
      });
    }
    return path.join(this.storageDir, storageKey);
  }
}
