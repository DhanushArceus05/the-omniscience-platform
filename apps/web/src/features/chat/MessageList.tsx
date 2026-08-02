import { useEffect, useRef, type JSX } from "react";
import { EmptyState } from "@omniscience/ui";
import { MessageBubble } from "./MessageBubble";
import type { ChatMessage } from "./useMessageStream";
import "./chat.css";

export function MessageList({ messages }: { messages: ChatMessage[] }): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // `scrollIntoView` is unavailable in some test environments (jsdom
    // doesn't implement layout) — guarded so tests never fail on this
    // purely cosmetic behavior.
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, messages[messages.length - 1]?.content]);

  if (messages.length === 0) {
    return (
      <EmptyState
        title="No messages yet"
        description="Send a message below to start the conversation."
      />
    );
  }

  return (
    <div className="omni-chat-message-list" aria-label="Conversation messages" role="log">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
