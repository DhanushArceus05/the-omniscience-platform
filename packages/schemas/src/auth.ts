import { z } from "zod";

/**
 * Single source of truth for the auth field-level validation rules
 * shared across `apps/api` (Nest DTO validation) and `apps/web` (form
 * validation), so the rules are never duplicated or allowed to drift
 * between frontend and backend.
 *
 * Phase 2 Step 2 scope: field-level primitives only. Composed request
 * schemas (register/login/etc.) are added in Step 3/4 once those flows
 * are implemented.
 */

/**
 * Normalizes (trims + lowercases) and validates an email address.
 * Normalizing here — not just at the Prisma layer — means every caller
 * that parses through this schema gets the same canonical value, so the
 * plain `@unique` index on `User.email` is sufficient without a Postgres
 * extension (e.g. `citext`).
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Email is required")
  .max(254, "Email must be at most 254 characters")
  .email("Enter a valid email address");

/**
 * Strong password policy for the approved authentication foundation.
 * The SRS doesn't specify exact complexity rules, so this uses a
 * commonly-accepted balanced policy: a meaningful minimum length plus a
 * mix of character classes, rather than an arbitrary single rule. Revisit
 * here (not per-endpoint) if the policy needs to change later.
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((value) => /[a-z]/.test(value), "Password must include a lowercase letter")
  .refine((value) => /[A-Z]/.test(value), "Password must include an uppercase letter")
  .refine((value) => /[0-9]/.test(value), "Password must include a number")
  .refine(
    (value) => /[^A-Za-z0-9]/.test(value),
    "Password must include a special character",
  );

/**
 * Display name, matching the "Full name" field already present on the
 * Phase 1 RegisterPage UI.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(100, "Name must be at most 100 characters");

export type Email = z.infer<typeof emailSchema>;
export type Password = z.infer<typeof passwordSchema>;
export type DisplayName = z.infer<typeof displayNameSchema>;
