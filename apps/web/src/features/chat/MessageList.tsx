import { useEffect, useRef, useState, type JSX, type UIEvent } from "react";
import { EmptyState } from "@omniscience/ui";
import { MessageBubble } from "./MessageBubble";
import type { ChatMessage } from "./useMessageStream";
import "./chat.css";

/** How close to the bottom (in px) still counts as "already at the bottom" for auto-scroll purposes. */
const NEAR_BOTTOM_THRESHOLD_PX = 80;

export interface MessageListProps {
  messages: ChatMessage[];
  /**
   * Phase 6 Step 5 — Message-Level UX. Called with no arguments when
   * the user regenerates the eligible assistant message — the actual
   * delete-then-resend logic lives entirely in `useMessageStream`'s
   * `regenerateLastAssistantMessage()`; this component only decides
   * *which* message may show the action.
   */
  onRegenerate?: () => void;
  /**
   * Phase 6 Step 5 — Message-Level UX. Called with the edited draft
   * when the user saves an edit to the eligible user message —
   * forwards straight to `useMessageStream`'s `editLastUserMessage()`.
   */
  onEditSave?: (newContent: string) => void;
}

/**
 * Computes which single message (if any) is eligible for "Regenerate"
 * — Phase 6 Step 5. Only the conversation's true final message, and
 * only when it's a finished (non-streaming, non-optimistic) assistant
 * reply. Mirrors the exact guard `useMessageStream.regenerateLastAssistantMessage()`
 * re-checks before acting — this is a display-only computation, never
 * trusted as the actual authorization (the backend re-derives the true
 * last message independently on every delete call).
 */
function regenerateEligibleMessageId(messages: ChatMessage[]): string | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || last.isStreaming || last.isOptimistic) {
    return null;
  }
  return last.id;
}

/**
 * Computes which single message (if any) is eligible for "Edit" —
 * Phase 6 Step 5. The conversation's most recent user-role message,
 * whether or not a trailing assistant reply follows it — covers a
 * conversation ending in an assistant reply, one ending directly in a
 * user message (no reply yet), and a failed last turn where no
 * assistant message was ever persisted. Never an optimistic (not yet
 * server-confirmed) message.
 */
function editEligibleMessageId(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "user") {
      return message.isOptimistic ? null : message.id;
    }
  }
  return null;
}

export function MessageList({ messages, onRegenerate, onEditSave }: MessageListProps): JSX.Element {
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // A ref (not just state) so the scroll-driven auto-scroll effect below
  // always reads the latest value without needing to be re-created on
  // every scroll.
  const isNearBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  function isScrolledNearBottom(): boolean {
    const el = scrollRegionRef.current;
    if (!el) return true;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
  }

  function handleScroll(_event: UIEvent<HTMLDivElement>): void {
    const nearBottom = isScrolledNearBottom();
    isNearBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }

  useEffect(() => {
    // Only follow new content (history load, a new message, or the next
    // streamed delta) when the user was already at/near the bottom —
    // scrolling up to re-read earlier messages must never be yanked
    // back down mid-stream. `scrollIntoView` is unavailable in some test
    // environments (jsdom doesn't implement layout) — guarded so tests
    // never fail on this purely cosmetic behavior.
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView?.({ block: "end" });
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(true);
    }
  }, [messages.length, messages[messages.length - 1]?.content]);

  function handleJumpToLatest(): void {
    bottomRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
    isNearBottomRef.current = true;
    setShowJumpToLatest(false);
  }

  if (messages.length === 0) {
    return (
      <EmptyState
        title="No messages yet"
        description="Send a message below to start the conversation."
      />
    );
  }

  const regenerateId = regenerateEligibleMessageId(messages);
  const editId = editEligibleMessageId(messages);

  return (
    <>
      <div
        ref={scrollRegionRef}
        className="omni-chat-message-list"
        aria-label="Conversation messages"
        role="log"
        onScroll={handleScroll}
      >
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            canRegenerate={message.id === regenerateId}
            canEdit={message.id === editId}
            onRegenerate={onRegenerate}
            onEditSave={onEditSave}
          />
        ))}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
      {showJumpToLatest && (
        <button type="button" className="omni-chat-jump-to-latest" onClick={handleJumpToLatest}>
          <span aria-hidden="true">↓</span> Jump to latest
        </button>
      )}
    </>
  );
}
