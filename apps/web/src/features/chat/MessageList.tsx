import { useEffect, useRef, useState, type JSX, type UIEvent } from "react";
import { EmptyState } from "@omniscience/ui";
import { MessageBubble } from "./MessageBubble";
import type { ChatMessage } from "./useMessageStream";
import "./chat.css";

/** How close to the bottom (in px) still counts as "already at the bottom" for auto-scroll purposes. */
const NEAR_BOTTOM_THRESHOLD_PX = 80;

export function MessageList({ messages }: { messages: ChatMessage[] }): JSX.Element {
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
          <MessageBubble key={message.id} message={message} />
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
