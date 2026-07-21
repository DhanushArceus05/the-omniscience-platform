import { z } from "zod";

/**
 * Shared request schemas for the Phase 4 Step 1 OmniProvider / Model
 * Manager diagnostic endpoints (`GET /ai/providers`, `GET /ai/models`).
 * Both endpoints are read-only `GET`s, so these validate query strings
 * only — there is no request body in this step.
 */

/**
 * The full `ModelCapability`/`ProviderCapability` vocabulary, kept in
 * sync with `@omniscience/types`'s `ProviderCapability` union by hand
 * (schemas can't import a type-only union at runtime). Any change to
 * one must be mirrored in the other — covered by
 * `ai-provider.test.ts`'s exhaustiveness check.
 */
export const capabilityValues = [
  "text-generation",
  "embeddings",
  "vision",
  "speech-to-text",
  "text-to-speech",
  "structured-output",
  "tool-calling",
  "streaming",
] as const;

export const capabilitySchema = z.enum(capabilityValues);

/**
 * `GET /ai/models` query params. `capability` filters to models
 * supporting that one capability; `provider` filters to a single
 * provider id. Both optional — omitting either returns the unfiltered
 * catalog. `.strict()` rejects unknown query params, same
 * defense-in-depth convention as `listWorkspacesQuerySchema`.
 */
export const listModelsQuerySchema = z
  .object({
    capability: capabilitySchema.optional(),
    provider: z.string().trim().min(1, "provider must not be empty").optional(),
  })
  .strict();

export type CapabilitySchema = z.infer<typeof capabilitySchema>;
export type ListModelsQuerySchema = z.infer<typeof listModelsQuerySchema>;
