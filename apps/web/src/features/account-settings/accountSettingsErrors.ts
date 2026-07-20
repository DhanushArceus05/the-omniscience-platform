import { ApiClientError } from "@omniscience/sdk";

/**
 * Human-readable copy for the stable error `code`s the profile/avatar/
 * password/session/account-deletion endpoints return, following the
 * same convention `apps/web/src/lib/auth/authErrors.ts` and
 * `apps/web/src/features/workspaces/workspaceErrors.ts` already
 * establish: own the wording here, react to the backend's stable
 * `code`, never trust its `message` verbatim as UI copy.
 */
const ACCOUNT_SETTINGS_ERROR_MESSAGES: Record<string, string> = {
  CURRENT_PASSWORD_INCORRECT: "The current password you entered is incorrect.",
  NEW_PASSWORD_MUST_DIFFER: "Your new password must be different from your current password.",
  SESSION_NOT_FOUND: "That session could not be found — it may already be signed out.",
  AVATAR_TYPE_UNSUPPORTED: "Please upload a JPEG, PNG, or WebP image.",
  AVATAR_TOO_LARGE: "That image is too large. Please choose a smaller file (5MB or less).",
  AVATAR_STORAGE_ERROR: "The avatar could not be saved right now. Please try again.",
  AVATAR_UPLOAD_ERROR: "The avatar could not be uploaded. Please try again.",
  VALIDATION_ERROR: "Please check the highlighted fields.",
  UNAUTHORIZED: "Your session has expired. Please sign in again.",
  NETWORK_ERROR: "Could not reach the server. Check your connection and try again.",
  INVALID_RESPONSE: "The server sent back something unexpected. Please try again.",
};

/** Resolves a caught error (ideally an `ApiClientError`) to display copy for the account settings experience. */
export function getAccountSettingsErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return ACCOUNT_SETTINGS_ERROR_MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
