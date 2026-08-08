import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { OmniscienceClient } from "@omniscience/sdk";
import type { Message, MessageRole, MessageStatus } from "@omniscience/types";
import { getChatErrorMessage } from "./chatErrors";

/**
 * A message as rendered in the chat feature — a superset of the
 * persisted `Message` shape (`@omniscience/types`) with two additional,
 * purely client-side flags:
 *
 * - `isOptimistic`: true for a just-sent user message that hasn't yet
 *   been reconciled with the server's persisted copy (arrives on the
 *   stream's `start` event). Never true for anything loaded from
 *   `listMessages()` history.
 * - `isStreaming`: true for the one assistant message currently
 *   receiving `delta` text. Its `content` grows incrementally; its
 *   `id` is a client-generated placeholder until the stream's `done`
 *   event replaces it with the real persisted `assistantMessage`.
 *
 * Both flags are `undefined` (never `true`) once a turn finishes
 * (`done`) — a `ChatMessage` at rest is indistinguishable from a plain
 * `Message`.
 */
export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status: MessageStatus;
  isOptimistic?: boolean;
  isStreaming?: boolean;
}

function toChatMessage(message: Message): ChatMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    status: message.status,
  };
}

interface State {
  messages: ChatMessage[];
  /** id of the optimistic user `ChatMessage` awaiting `start` reconciliation, or `null`. */
  pendingUserId: string | null;
  /** id of the in-progress streaming assistant `ChatMessage` that `delta` text targets, or `null`. */
  streamingAssistantId: string | null;
}

const INITIAL_STATE: State = { messages: [], pendingUserId: null, streamingAssistantId: null };

type Action =
  | { type: "reset" }
  | { type: "hydrate"; messages: Message[] }
  | { type: "send_start"; tempId: string; conversationId: string; content: string; createdAt: string }
  | { type: "stream_start"; tempId: string; userMessage: Message; streamingId: string }
  | { type: "stream_delta"; text: string }
  | { type: "stream_done"; assistantMessage: Message }
  | { type: "stream_error" }
  | { type: "stream_aborted" }
  | { type: "send_failed"; tempId: string }
  | { type: "remove_trailing"; ids: string[] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return INITIAL_STATE;

    case "hydrate":
      return { messages: action.messages.map(toChatMessage), pendingUserId: null, streamingAssistantId: null };

    case "send_start":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.tempId,
            conversationId: action.conversationId,
            role: "user",
            content: action.content,
            createdAt: action.createdAt,
            status: "complete",
            isOptimistic: true,
          },
        ],
        pendingUserId: action.tempId,
      };

    case "stream_start":
      return {
        ...state,
        messages: [
          ...state.messages.map((message) =>
            message.id === action.tempId ? toChatMessage(action.userMessage) : message,
          ),
          {
            id: action.streamingId,
            conversationId: action.userMessage.conversationId,
            role: "assistant",
            content: "",
            createdAt: action.userMessage.createdAt,
            status: "incomplete",
            isStreaming: true,
          },
        ],
        pendingUserId: null,
        streamingAssistantId: action.streamingId,
      };

    case "stream_delta":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === state.streamingAssistantId
            ? { ...message, content: message.content + action.text }
            : message,
        ),
      };

    case "stream_done":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === state.streamingAssistantId ? toChatMessage(action.assistantMessage) : message,
        ),
        streamingAssistantId: null,
      };

    case "stream_error":
    case "stream_aborted":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === state.streamingAssistantId
            ? { ...message, isStreaming: false, status: "incomplete" }
            : message,
        ),
        streamingAssistantId: null,
      };

    case "send_failed":
      return {
        ...state,
        messages: state.messages.filter((message) => message.id !== action.tempId),
        pendingUserId: null,
      };

    // Phase 6 Step 5 — Message-Level UX. Removes one or two
    // successfully-deleted trailing messages by id, ahead of a
    // regenerate/edit-and-resend's follow-up `sendMessage()` call.
    // Deliberately not scoped to "the last N messages" positionally —
    // it removes exactly the ids the caller already confirmed were
    // deleted server-side (see `regenerateLastAssistantMessage()`/
    // `editLastUserMessage()` below), so there's no risk of this
    // silently removing the wrong message if state changed underneath
    // it between the delete call and this dispatch.
    case "remove_trailing":
      return {
        ...state,
        messages: state.messages.filter((message) => !action.ids.includes(message.id)),
      };

    default:
      return state;
  }
}

export interface UseMessageStreamOptions {
  client: OmniscienceClient | null;
  accessToken: string | null;
  workspaceId: string;
  conversationId: string | null;
}

export interface UseMessageStreamResult {
  messages: ChatMessage[];
  /** True while a send/stream is in flight for this conversation — the composer and conversation switcher should treat this as busy. */
  isStreaming: boolean;
  /**
   * Set only when the most recent turn ended in a mid-stream `error`
   * event or an unrecoverable pre-stream failure — display copy for a
   * retry affordance. Cleared on the next `sendMessage`/`retry` call or
   * on `hydrate`.
   */
  streamError: string | null;
  /** Replaces the message list wholesale — used once after loading a conversation's history via `listMessages()`. */
  hydrate: (messages: Message[]) => void;
  /** Clears the message list — used when switching to a conversation whose history hasn't loaded yet. */
  reset: () => void;
  /** Sends `content` and streams the assistant's reply. A no-op while already streaming. */
  sendMessage: (content: string) => void;
  /** Re-sends the last message that was sent through this hook, if any. A no-op while already streaming or if nothing has been sent yet. */
  retry: () => void;
  /** Aborts the in-flight stream, if any. The partial assistant text remains visible, marked incomplete. */
  stopStreaming: () => void;
  /**
   * Phase 6 Step 5 — Message-Level UX. Deletes the current last
   * assistant message (via the guarded backend primitive) and, only on
   * success, resends the user message immediately preceding it through
   * the unmodified `sendMessage()` path. A no-op while streaming, or if
   * the last message isn't a finished (non-optimistic, non-streaming)
   * assistant message. A failed delete never removes the local message
   * and never triggers a resend — surfaced via `streamError` instead.
   */
  regenerateLastAssistantMessage: () => void;
  /**
   * Phase 6 Step 5 — Message-Level UX. Edits and resends the current
   * last user message: deletes the trailing assistant reply first if
   * one exists, then the user message itself, then resends
   * `newContent` through the unmodified `sendMessage()` path. A no-op
   * while streaming, if `newContent` is empty after trimming, or if
   * there's no eligible (non-optimistic) last user message. A failed
   * delete never removes the local message and never triggers a
   * resend — surfaced via `streamError` instead.
   */
  editLastUserMessage: (newContent: string) => void;
}

/**
 * Owns the active conversation's message list — history, the
 * optimistic user message, and the live-streaming assistant reply —
 * and drives `client.sendMessageStream()` (the Phase 6 Step 2 SDK
 * method, consumed exactly as implemented; this hook does not
 * reinterpret SSE framing, only react to the already-parsed
 * `MessageStreamEvent`s it yields).
 *
 * One hook instance is expected to be re-created (or explicitly
 * `reset`) per active conversation — see `ChatPanel`'s composition —
 * so `workspaceId`/`conversationId` below exist purely to invalidate
 * and abort an in-flight stream if either changes out from under this
 * hook instance while a send is in progress, not to be switched
 * arbitrarily on a single instance.
 */
export function useMessageStream(options: UseMessageStreamOptions): UseMessageStreamResult {
  const { client, accessToken, workspaceId, conversationId } = options;
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // `isStreaming` as a ref, not just state, so `sendMessage`'s
  // duplicate-submit guard reads the live value even inside a stable
  // `useCallback` — a plain state read inside a callback created before
  // the most recent render could otherwise see a stale `false`.
  const isStreamingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const idCounterRef = useRef(0);
  const lastSentContentRef = useRef<string | null>(null);
  // Bumped on every unmount/conversation-or-workspace change and
  // compared inside the streaming loop below, so an event or error from
  // a stream that's no longer "current" (the user switched conversations,
  // or the component unmounted, while it was in flight) is silently
  // ignored instead of mutating state for a conversation that's no
  // longer showing.
  const generationRef = useRef(0);

  const abortActiveStream = useCallback(() => {
    generationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    // The in-flight send's own `finally` block intentionally no-ops on a
    // generation mismatch (see below) — so if a stream is invalidated
    // here rather than via `stopStreaming()`, this is the only place
    // that resets `isStreaming` for it. Without this, a hook instance
    // whose conversation/workspace changed (or that unmounted) while a
    // send was in flight would report `isStreaming: true` forever.
    isStreamingRef.current = false;
    setIsStreaming(false);
  }, []);

  // Aborts any in-flight stream when the conversation/workspace this
  // hook instance is scoped to changes, or when it unmounts — required
  // regardless of whether the parent also re-keys/reset()s the hook,
  // since an in-flight `fetch` otherwise keeps running (and billing
  // provider tokens) after nothing is listening to it anymore.
  useEffect(() => {
    return () => {
      abortActiveStream();
    };
  }, [workspaceId, conversationId, abortActiveStream]);

  const hydrate = useCallback((messages: Message[]) => {
    setStreamError(null);
    dispatch({ type: "hydrate", messages });
  }, []);

  const reset = useCallback(() => {
    setStreamError(null);
    dispatch({ type: "reset" });
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || isStreamingRef.current) {
        return;
      }
      if (!client || !accessToken || !conversationId) {
        setStreamError("Chat is unavailable right now — please try again.");
        return;
      }

      lastSentContentRef.current = trimmed;

      const generation = generationRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const tempId = `temp-user-${++idCounterRef.current}`;
      const streamingId = `temp-assistant-${idCounterRef.current}`;

      setStreamError(null);
      setIsStreaming(true);
      isStreamingRef.current = true;
      dispatch({
        type: "send_start",
        tempId,
        conversationId,
        content: trimmed,
        createdAt: new Date().toISOString(),
      });

      let sawStart = false;

      void (async () => {
        try {
          const events = client.sendMessageStream(accessToken, workspaceId, conversationId, trimmed, {
            signal: controller.signal,
          });

          for await (const event of events) {
            if (generationRef.current !== generation) {
              // A newer generation has already started (conversation
              // switched, or this hook unmounted) — that transition
              // already aborted this exact controller; there is
              // nothing left to reconcile against a message list that
              // no longer belongs to this stream.
              return;
            }

            switch (event.event) {
              case "start":
                sawStart = true;
                dispatch({ type: "stream_start", tempId, userMessage: event.data.userMessage, streamingId });
                break;
              case "delta":
                dispatch({ type: "stream_delta", text: event.data.text });
                break;
              case "done":
                dispatch({ type: "stream_done", assistantMessage: event.data.assistantMessage });
                break;
              case "error":
                setStreamError(
                  event.data.message
                    ? event.data.message
                    : "The assistant couldn't finish responding. You can try again.",
                );
                dispatch({ type: "stream_error" });
                break;
            }
          }
        } catch (error) {
          if (generationRef.current !== generation) {
            return;
          }
          if (controller.signal.aborted) {
            if (sawStart) {
              dispatch({ type: "stream_aborted" });
            } else {
              // Aborted before the server ever confirmed the user
              // message was persisted — nothing to mark incomplete,
              // and leaving the optimistic bubble in place would claim
              // a send that never actually happened.
              dispatch({ type: "send_failed", tempId });
            }
            return;
          }
          if (!sawStart) {
            // A pre-stream failure — ownership/validation/rate-limit/
            // network — throws before the server's first `start` event,
            // exactly mirroring the endpoint's own "LOCKED ERROR
            // SEMANTICS." Nothing was ever persisted, so the optimistic
            // user bubble must not linger.
            dispatch({ type: "send_failed", tempId });
            setStreamError(getChatErrorMessage(error));
            return;
          }
          // The stream was interrupted after `start` by something other
          // than a well-formed `error` event or an explicit abort (e.g.
          // a dropped connection) — treat like a mid-stream error: keep
          // the partial text, mark it incomplete, surface a retry.
          dispatch({ type: "stream_error" });
          setStreamError(getChatErrorMessage(error));
        } finally {
          if (generationRef.current === generation) {
            setIsStreaming(false);
            isStreamingRef.current = false;
            abortControllerRef.current = null;
          }
        }
      })();
    },
    [client, accessToken, workspaceId, conversationId],
  );

  const retry = useCallback(() => {
    if (lastSentContentRef.current) {
      sendMessage(lastSentContentRef.current);
    }
  }, [sendMessage]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // `state.messages` is a dependency of both callbacks below (not read
  // from a ref) so each call always sees the message list as it stood
  // at click time — same reasoning `useConversations.ts`'s
  // `renameConversation()`/`deleteConversation()` already documents for
  // reading pre-call state synchronously rather than out of a `setState`
  // updater's side effect.

  const regenerateLastAssistantMessage = useCallback(() => {
    if (isStreamingRef.current) {
      return;
    }
    if (!client || !accessToken || !conversationId) {
      setStreamError("Chat is unavailable right now — please try again.");
      return;
    }

    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant" || lastMessage.isStreaming || lastMessage.isOptimistic) {
      return;
    }
    const precedingUser = messages[messages.length - 2];
    if (!precedingUser || precedingUser.role !== "user") {
      // This app always alternates user/assistant, so this shouldn't
      // happen in practice — guarded anyway rather than assumed.
      return;
    }

    const assistantId = lastMessage.id;
    const userContent = precedingUser.content;

    setStreamError(null);
    void (async () => {
      try {
        await client.deleteMessage(accessToken, workspaceId, conversationId, assistantId);
      } catch (error) {
        // Delete failed — the message stays exactly as it was, and
        // nothing is resent. Same accepted-limitation reasoning as
        // `editLastUserMessage()` below: this method never guesses at
        // recovery, it just reports the failure.
        setStreamError(getChatErrorMessage(error));
        return;
      }
      dispatch({ type: "remove_trailing", ids: [assistantId] });
      sendMessage(userContent);
    })();
  }, [client, accessToken, workspaceId, conversationId, state.messages, sendMessage]);

  const editLastUserMessage = useCallback(
    (newContent: string) => {
      const trimmed = newContent.trim();
      if (!trimmed) {
        return;
      }
      if (isStreamingRef.current) {
        return;
      }
      if (!client || !accessToken || !conversationId) {
        setStreamError("Chat is unavailable right now — please try again.");
        return;
      }

      const messages = state.messages;
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage) {
        return;
      }

      let userMessage: ChatMessage;
      let trailingAssistant: ChatMessage | null = null;

      if (lastMessage.role === "assistant") {
        const precedingUser = messages[messages.length - 2];
        if (!precedingUser || precedingUser.role !== "user") {
          return;
        }
        trailingAssistant = lastMessage;
        userMessage = precedingUser;
      } else if (lastMessage.role === "user") {
        userMessage = lastMessage;
      } else {
        return;
      }

      if (userMessage.isOptimistic) {
        return;
      }

      const userMessageId = userMessage.id;
      const trailingAssistantId = trailingAssistant?.id ?? null;

      setStreamError(null);
      void (async () => {
        try {
          // Delete-then-resend is intentionally not transactional (the
          // standalone MongoDB deployment can't provide multi-document
          // transactions, and a transaction couldn't span the external,
          // non-transactional resend call below anyway — Phase 6 Step 5's
          // accepted limitation, see `claude/PHASE_PLAN.md`). Each delete
          // is only reflected locally after it genuinely succeeds — if
          // the assistant delete succeeds but the user-message delete
          // then fails, the assistant reply stays deleted and the user
          // message stays exactly as it was; nothing is resent.
          if (trailingAssistantId) {
            await client.deleteMessage(accessToken, workspaceId, conversationId, trailingAssistantId);
            dispatch({ type: "remove_trailing", ids: [trailingAssistantId] });
          }
          await client.deleteMessage(accessToken, workspaceId, conversationId, userMessageId);
        } catch (error) {
          setStreamError(getChatErrorMessage(error));
          return;
        }
        dispatch({ type: "remove_trailing", ids: [userMessageId] });
        sendMessage(trimmed);
      })();
    },
    [client, accessToken, workspaceId, conversationId, state.messages, sendMessage],
  );

  return {
    messages: state.messages,
    isStreaming,
    streamError,
    hydrate,
    reset,
    sendMessage,
    retry,
    stopStreaming,
    regenerateLastAssistantMessage,
    editLastUserMessage,
  };
}
