import { ApiClientError } from "@omniscience/sdk";

/**
 * Human-readable copy for the stable error `code`s `AuthService`
 * (`apps/api/src/auth/auth.service.ts`) returns. Keeping this map here —
 * rather than trusting the backend's `message` verbatim — means the
 * frontend controls its own tone/wording independently of backend copy
 * changes, while still reacting to the same stable `code` contract.
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  EMAIL_ALREADY_REGISTERED: "An account with this email already exists. Try signing in instead.",
  PENDING_REGISTRATION_NOT_FOUND:
    "We couldn't find a pending registration for this email. Please register again.",
  OTP_MAX_ATTEMPTS_EXCEEDED: "Too many incorrect attempts. Please request a new code.",
  OTP_EXPIRED: "This code has expired. Please request a new one.",
  OTP_INCORRECT: "That code isn't correct. Please try again.",
  OTP_RESEND_COOLDOWN: "Please wait a little before requesting another code.",
  INVALID_CREDENTIALS: "Incorrect email or password.",
  EMAIL_NOT_VERIFIED: "Please verify your email before signing in.",
  PASSWORD_RESET_NOT_FOUND:
    "We couldn't find a password reset in progress for this email. Please start again.",
  VALIDATION_ERROR: "Please check the highlighted fields.",
  NETWORK_ERROR: "Could not reach the server. Check your connection and try again.",
  INVALID_RESPONSE: "The server sent back something unexpected. Please try again.",
};

/** Field-level validation error, keyed by the `@omniscience/schemas` field path. */
export type FieldErrors = Record<string, string>;

/** Resolves a caught error (ideally an `ApiClientError`) to display copy. */
export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return AUTH_ERROR_MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Extracts per-field messages from a `VALIDATION_ERROR` `ApiClientError`
 * (the `ZodValidationPipe` shape: `details: { path, message }[]`) so a
 * form can highlight the exact fields the backend rejected — the same
 * shape client-side `safeParse` failures are normalized to below.
 */
export function getFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiClientError) || error.code !== "VALIDATION_ERROR") {
    return {};
  }
  const details = error.details;
  if (!Array.isArray(details)) {
    return {};
  }
  const fields: FieldErrors = {};
  for (const detail of details as Array<{ path?: unknown; message?: unknown }>) {
    if (typeof detail?.path === "string" && typeof detail?.message === "string" && detail.path) {
      fields[detail.path] = detail.message;
    }
  }
  return fields;
}

/** True when the caught error is an `ApiClientError` with the given backend `code`. */
export function isAuthErrorCode(error: unknown, code: string): boolean {
  return error instanceof ApiClientError && error.code === code;
}
