import { ApiClientError } from "@omniscience/sdk";

/**
 * Human-readable copy for the workspace endpoints' stable error `code`s
 * (`apps/api/src/workspaces/workspaces.service.ts`), following the same
 * convention `apps/web/src/lib/auth/authErrors.ts` established: own the
 * wording here, react to the backend's stable `code`, never trust its
 * `message` verbatim as UI copy.
 */
const WORKSPACE_ERROR_MESSAGES: Record<string, string> = {
  WORKSPACE_NOT_FOUND: "That workspace could not be found.",
  INVALID_CURSOR: "Couldn't load more workspaces — please refresh and try again.",
  VALIDATION_ERROR: "Please check the highlighted fields.",
  UNAUTHORIZED: "Your session has expired. Please sign in again.",
  NETWORK_ERROR: "Could not reach the server. Check your connection and try again.",
  INVALID_RESPONSE: "The server sent back something unexpected. Please try again.",
};

/** Resolves a caught error (ideally an `ApiClientError`) to display copy for the workspace dashboard. */
export function getWorkspaceErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return WORKSPACE_ERROR_MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
