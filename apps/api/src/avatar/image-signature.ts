/**
 * Detects an image's *real* format from its magic bytes (the file's
 * actual binary signature), independent of whatever `mimetype`/filename
 * extension the uploading client claims. A client-declared
 * `Content-Type`/filename is trivial to spoof; this is the
 * "file-signature/content validation" layer `AvatarStorageService`
 * requires in addition to (never instead of) the declared MIME type —
 * both must agree with one of the three formats this platform accepts
 * before an upload is accepted.
 *
 * Deliberately supports exactly three formats — JPEG, PNG, WebP — and
 * nothing else. In particular, no SVG: SVG is XML and can embed
 * executable script, and this repo has no proven sanitization strategy
 * for it (per the approved Step 3 scope, SVG stays unsupported until
 * one exists).
 */
export type DetectedImageType = "jpeg" | "png" | "webp";

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// WebP is a RIFF container: bytes 0-3 are "RIFF", bytes 8-11 are "WEBP"
// (bytes 4-7 are a little-endian file-size field that varies per file).
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function matchesSignature(buffer: Buffer, offset: number, signature: number[]): boolean {
  if (buffer.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[offset + i] !== signature[i]) return false;
  }
  return true;
}

/** Returns the detected format, or `null` if the buffer matches none of the three accepted signatures. */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (matchesSignature(buffer, 0, JPEG_SIGNATURE)) return "jpeg";
  if (matchesSignature(buffer, 0, PNG_SIGNATURE)) return "png";
  if (matchesSignature(buffer, 0, RIFF_SIGNATURE) && matchesSignature(buffer, 8, WEBP_SIGNATURE)) {
    return "webp";
  }
  return null;
}

/** Maps a detected type to the file extension `AvatarStorageService` generates storage keys with. */
export function extensionForImageType(type: DetectedImageType): "jpg" | "png" | "webp" {
  switch (type) {
    case "jpeg":
      return "jpg";
    case "png":
      return "png";
    case "webp":
      return "webp";
  }
}

/** The MIME types accepted as the client-declared `Content-Type` — must also match `detectImageType` (defense in depth, neither check alone is trusted). */
export const ALLOWED_AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedAvatarMimeType = (typeof ALLOWED_AVATAR_MIME_TYPES)[number];

export function isAllowedAvatarMimeType(value: string): value is AllowedAvatarMimeType {
  return (ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(value);
}
