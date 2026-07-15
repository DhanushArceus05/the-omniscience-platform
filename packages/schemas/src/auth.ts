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

/**
 * Phase 2 Step 3 — composed request schemas for the registration + OTP
 * verification endpoints. Built entirely from the field-level schemas
 * above, so a rule change to (e.g.) password strength only needs to
 * happen in one place.
 */
export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit verification code");

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: displayNameSchema,
});

export const verifyOtpRequestSchema = z.object({
  email: emailSchema,
  otp: otpCodeSchema,
});

export const resendOtpRequestSchema = z.object({
  email: emailSchema,
});

export type OtpCode = z.infer<typeof otpCodeSchema>;
export type RegisterRequestSchema = z.infer<typeof registerRequestSchema>;
export type VerifyOtpRequestSchema = z.infer<typeof verifyOtpRequestSchema>;
export type ResendOtpRequestSchema = z.infer<typeof resendOtpRequestSchema>;

/**
 * Phase 2 Step 4 — login, refresh, and logout request schemas.
 *
 * `loginPasswordSchema` is deliberately NOT `passwordSchema`: login must
 * accept whatever password an existing account was created with, even if
 * the strength policy above is tightened later. Policy is enforced only
 * at creation time (registration); login only needs "a non-empty string
 * up to a sane length", so a policy change can never lock out existing
 * users. `refreshToken` is validated as a non-empty string only —
 * `RefreshTokenStore` itself is the source of truth for whether a given
 * token is well-formed/valid.
 */
export const loginPasswordSchema = z.string().min(1, "Password is required").max(128);

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
});

export const refreshTokenSchema = z.string().min(1, "Refresh token is required");

export const refreshRequestSchema = z.object({
  refreshToken: refreshTokenSchema,
});

export const logoutRequestSchema = z.object({
  refreshToken: refreshTokenSchema,
});

export type LoginRequestSchema = z.infer<typeof loginRequestSchema>;
export type RefreshRequestSchema = z.infer<typeof refreshRequestSchema>;
export type LogoutRequestSchema = z.infer<typeof logoutRequestSchema>;

/**
 * Phase 2 Step 5 — forgot-password and reset-password request schemas.
 *
 * `forgotPasswordRequestSchema` takes only an email — the endpoint itself
 * always responds the same way regardless of whether the address is
 * registered, so there is nothing else to validate at this stage.
 * `resetPasswordRequestSchema` reuses `otpCodeSchema` (same 6-digit code
 * shape as registration) and `passwordSchema` (the new password must meet
 * the same strength policy as registration — a reset is a fresh
 * credential, not an existing one like `loginPasswordSchema`).
 */
export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});

export const resetPasswordRequestSchema = z.object({
  email: emailSchema,
  otp: otpCodeSchema,
  newPassword: passwordSchema,
});

export type ForgotPasswordRequestSchema = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequestSchema = z.infer<typeof resetPasswordRequestSchema>;
