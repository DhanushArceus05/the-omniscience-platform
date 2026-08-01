/**
 * SSE event contracts for Phase 6 Step 2 (backend-only authenticated
 * assistant response streaming) —
 * `POST /workspaces/:workspaceId/conversations/:conversationId/messages/stream`.
 *
 * This is the wire shape only. The transport is SSE-formatted events
 * over an authenticated `fetch()` + `ReadableStream` POST — never a
 * native `EventSource` (which cannot attach the `Authorization`
 * header this endpoint requires) — so these types describe the
 * *parsed* `{ event, data }` pair `@omniscience/sdk`'s
 * `sendMessageStream()` hands back after framing/decoding, not raw
 * SSE bytes.
 *
 * Every event name here matches the literal `event:` line the server
 * writes:
 *
 *   event: start   → { userMessage: Message }
 *   event: delta   → { text: string }
 *   event: done    → { assistantMessage: Message }
 *   event: error   → { code: string; message: string }
 *
 * `error.data.code` is always one of this repository's existing
 * `AiDomainErrorCode`/`OmniCoreDomainErrorCode`/
 * `ConversationsDomainErrorCode` values (e.g. `PROVIDER_UNAVAILABLE`,
 * `EXECUTION_CANCELLED`) — Phase 6 Step 2 introduces no new domain
 * error vocabulary of its own, only a new transport for delivering
 * one of those existing codes mid-stream instead of as an HTTP status.
 */

import type { Message } from "./conversations";

export interface MessageStreamStartEvent {
  readonly event: "start";
  readonly data: {
    readonly userMessage: Message;
  };
}

export interface MessageStreamDeltaEvent {
  readonly event: "delta";
  readonly data: {
    readonly text: string;
  };
}

export interface MessageStreamDoneEvent {
  readonly event: "done";
  readonly data: {
    readonly assistantMessage: Message;
  };
}

/**
 * `code` is deliberately a plain `string`, not a union of every
 * domain error code enum across `ai`/`omnicore`/`conversations` —
 * mirroring `StepExecutionResult.errorCode`'s own reasoning
 * (`omnicore-execution.ts`) — so this file never needs to depend on
 * any of those modules' own error-code types.
 */
export interface MessageStreamErrorEvent {
  readonly event: "error";
  readonly data: {
    readonly code: string;
    readonly message: string;
  };
}

/** The full discriminated union a stream consumer switches on by `.event`. */
export type MessageStreamEvent =
  | MessageStreamStartEvent
  | MessageStreamDeltaEvent
  | MessageStreamDoneEvent
  | MessageStreamErrorEvent;
