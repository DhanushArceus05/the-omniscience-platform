import { z } from "zod";
import { displayNameSchema, loginPasswordSchema, passwordSchema } from "./auth";

/**
 * User-profile request schemas (Phase 2 Step 6).
 *
 * `updateProfileRequestSchema` reuses `displayNameSchema` (Step 2) — the
 * same strength/length rules the registration form already applies to
 * `name`. Deliberately does not include `email`: changing the address a
 * verified account is tied to is a materially bigger, riskier feature
 * (it would need its own re-verification flow, mirroring registration's
 * OTP step) and is out of this step's approved scope.
 *
 * `changePasswordRequestSchema` reuses `loginPasswordSchema` for
 * `currentPassword` (an *existing* credential being asserted, not a new
 * one being chosen — same reasoning `loginRequestSchema` already
 * applies) and the full `passwordSchema` strength policy for
 * `newPassword`, exactly like `resetPasswordRequestSchema` (Step 5) —
 * a changed password is always a fresh credential and must meet the
 * current policy regardless of what the old one satisfied.
 */
export const updateProfileRequestSchema = z.object({
  name: displayNameSchema,
});

export const changePasswordRequestSchema = z.object({
  currentPassword: loginPasswordSchema,
  newPassword: passwordSchema,
});

export type UpdateProfileRequestSchema = z.infer<typeof updateProfileRequestSchema>;
export type ChangePasswordRequestSchema = z.infer<typeof changePasswordRequestSchema>;
