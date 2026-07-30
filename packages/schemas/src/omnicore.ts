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
 *
 * `MAX_OMNICORE_PROMPT_LENGTH`/`omniCorePromptSchema` are exported
 * (Phase 6 Step 1) so any future caller of `OmniCoreService.execute()`
 * that needs its own request schema — today, `sendMessageRequestSchema`
 * in `./conversations.ts` — reuses this exact field-level rule instead
 * of duplicating the `8_000` limit in a second place where it could
 * silently drift out of sync.
 */
export const MAX_OMNICORE_PROMPT_LENGTH = 8_000;

export const omniCorePromptSchema = z
  .string()
  .trim()
  .min(1, "prompt is required")
  .max(MAX_OMNICORE_PROMPT_LENGTH, `prompt must be at most ${MAX_OMNICORE_PROMPT_LENGTH} characters`);

export const omniCoreExecuteRequestSchema = z
  .object({
    prompt: omniCorePromptSchema,
  })
  .strict();

export type OmniCoreExecuteRequestSchema = z.infer<typeof omniCoreExecuteRequestSchema>;
