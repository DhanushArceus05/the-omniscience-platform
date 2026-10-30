import { z } from "zod";

/**
 * Phase 7 Step 1 — Knowledge file schemas.
 *
 * Validation rules for knowledge file upload and management endpoints.
 * Field-level primitives + composed request schemas, following the same
 * pattern as `auth.ts` and `workspaces.ts`.
 */

/**
 * Allowed MIME types for knowledge file uploads (Step 1 scope).
 * PDF, DOCX, and TXT only — no other formats are supported in Phase 7.
 */
export const ALLOWED_KNOWLEDGE_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

/**
 * Allowed file extensions for knowledge file uploads.
 * Must match the MIME type validation — both are checked independently
 * to prevent spoofed Content-Type headers.
 */
export const ALLOWED_KNOWLEDGE_EXTENSIONS = [".pdf", ".docx", ".txt"] as const;

/**
 * Knowledge file ID param schema (for `:fileId` route params).
 * Non-empty string (Prisma `cuid()`), same pattern as `workspaceIdParamSchema`.
 */
export const knowledgeFileIdParamSchema = z
  .string()
  .trim()
  .min(1, "A file id is required");

export type KnowledgeFileIdParamSchema = z.infer<typeof knowledgeFileIdParamSchema>;
