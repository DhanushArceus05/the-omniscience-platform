import { z } from "zod";

/**
 * `POST /omnicore/execute` body (Phase 5 Step 1, unchanged by Step 2).
 * Same shape and validation rules as `generateTextRequestSchema` — a
 * single required `prompt`, trimmed before its length is checked so
 * whitespace-only input is rejected the same way empty input is,
 * capped at the same 8000-character limit as the existing
 * `/ai/generate` route. `.strict()` rejects any unknown field, in
 * particular an `intent`/`plan` the caller might try to force — even
 * with Step 2's richer intent taxonomy, OmniCore's own fast-rules
 * classification always decides the intent itself, never the caller.
 */
export const omniCoreExecuteRequestSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1, "prompt is required")
      .max(8_000, "prompt must be at most 8000 characters"),
  })
  .strict();

export type OmniCoreExecuteRequestSchema = z.infer<typeof omniCoreExecuteRequestSchema>;
