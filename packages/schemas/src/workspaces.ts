import { z } from "zod";

/**
 * Shared workspace request schemas (Phase 3 Step 2 — Workspace Data
 * Model, Ownership Isolation & Dashboard Listing).
 *
 * Field-level rules, so a policy change (e.g. a longer max name length)
 * only has to happen in one place, exactly like `packages/schemas/src/
 * auth.ts`'s `displayNameSchema` convention.
 */

/** Trimmed, 1–100 character workspace name. Empty after trimming is rejected. */
export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, "Workspace name is required")
  .max(100, "Workspace name must be at most 100 characters");

/** Optional, trimmed, up-to-500-character workspace description. */
export const workspaceDescriptionSchema = z
  .string()
  .trim()
  .max(500, "Description must be at most 500 characters")
  .optional();

/**
 * `POST /workspaces` body. `.strict()` rejects unknown fields — the
 * same defense-in-depth every new Phase 3 request schema should apply,
 * not just this one, so an unexpected/extra field surfaces as a clear
 * `VALIDATION_ERROR` instead of being silently ignored (or, worse,
 * silently accepted and later assumed to do something it doesn't).
 */
export const createWorkspaceRequestSchema = z
  .object({
    name: workspaceNameSchema,
    description: workspaceDescriptionSchema,
  })
  .strict();

/**
 * Bounded list pagination. `limit` defaults to
 * `DEFAULT_WORKSPACE_LIST_LIMIT` and is capped at
 * `MAX_WORKSPACE_LIST_LIMIT` — the endpoint can never be asked to return
 * an unbounded result set. `cursor` is treated as an opaque string here
 * (its own encoding is `WorkspacesService`'s concern); a malformed or
 * unowned cursor is rejected by the service layer, not this schema, so
 * this schema doesn't need — and deliberately doesn't have — any
 * knowledge of what a valid cursor looks like.
 */
export const DEFAULT_WORKSPACE_LIST_LIMIT = 20;
export const MAX_WORKSPACE_LIST_LIMIT = 50;

export const listWorkspacesQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1, "limit must be at least 1")
      .max(MAX_WORKSPACE_LIST_LIMIT, `limit must be at most ${MAX_WORKSPACE_LIST_LIMIT}`)
      .optional(),
    cursor: z.string().trim().min(1, "cursor must not be empty").optional(),
  })
  .strict();

/** `:id` route param for `GET /workspaces/:id` — a non-empty string (Prisma `cuid()`). */
export const workspaceIdParamSchema = z
  .string()
  .trim()
  .min(1, "A workspace id is required");

export type CreateWorkspaceRequestSchema = z.infer<typeof createWorkspaceRequestSchema>;
export type ListWorkspacesQuerySchema = z.infer<typeof listWorkspacesQuerySchema>;
export type WorkspaceIdParamSchema = z.infer<typeof workspaceIdParamSchema>;
