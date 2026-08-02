import { ApiClientError } from "@omniscience/sdk";

/**
 * Human-readable copy for the stable error `code`s the Phase 6
 * conversation/message endpoints can produce — both the ordinary
 * `ApiClientError.code` a pre-stream failure throws (ownership,
 * validation, rate limiting) and the `code` carried on a mid-stream
 * `MessageStreamErrorEvent` (`@omniscience/types`'s
 * `conversation-stream.ts`), which reuses the exact same domain error
 * vocabulary — `apps/api` introduces no new codes for streaming, only
 * a new transport for delivering one of these mid-stream instead of as
 * an HTTP status. Same convention as `workspaceErrors.ts`/
 * `authErrors.ts`: own the wording here, react to the backend's stable
 * `code`, never trust either surface's `message` verbatim as UI copy.
 */
const CHAT_ERROR_MESSAGES: Record<string, string> = {
  WORKSPACE_NOT_FOUND: "That workspace could not be found.",
  CONVERSATION_NOT_FOUND: "That conversation could not be found.",
  INVALID_CURSOR: "Couldn't load more — please refresh and try again.",
  VALIDATION_ERROR: "Please check your message and try again.",
  UNAUTHORIZED: "Your session has expired. Please sign in again.",
  NETWORK_ERROR: "Could not reach the server. Check your connection and try again.",
  INVALID_RESPONSE: "The server sent back something unexpected. Please try again.",
  RATE_LIMITED: "You're sending messages too quickly. Please wait a moment and try again.",
  EXECUTION_CANCELLED: "Generation was stopped.",
  PROVIDER_UNAVAILABLE: "The assistant is temporarily unavailable. Please try again.",
  NO_COMPATIBLE_MODEL: "No AI model is currently available to handle this request.",
  AMBIGUOUS_INTENT: "I wasn't sure how to handle that — could you rephrase?",
};

/** Resolves a caught error (ideally an `ApiClientError`) to display copy for the chat feature. */
export function getChatErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return CHAT_ERROR_MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/** Resolves a mid-stream `MessageStreamErrorEvent.data`'s stable `code` to display copy. */
export function getStreamErrorMessage(data: { code: string; message: string }): string {
  return CHAT_ERROR_MESSAGES[data.code] ?? data.message;
}
