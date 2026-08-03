import { useState, type JSX } from "react";
import { Badge, Button, GlassCard, Spinner } from "@omniscience/ui";
import { MarkdownMessage } from "./MarkdownMessage";
import type { ChatMessage } from "./useMessageStream";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Renders one `ChatMessage`. Assistant content is rendered as real
 * Markdown (`MarkdownMessage`) — headings, emphasis, lists, code
 * blocks, tables, links, etc. — rather than shown as raw `**`/`#`/`-`
 * syntax. User messages stay plain preformatted text
 * (`white-space: pre-wrap`): a person's own typed input shouldn't be
 * reinterpreted as Markdown they didn't necessarily intend as such.
 */
export function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === "user";
  const isEmptyStreamingPlaceholder = message.isStreaming && message.content.length === 0;
  const [copied, setCopied] = useState(false);
  const canCopy = !isUser && !message.isStreaming && message.content.length > 0;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <GlassCard
        style={{
          maxWidth: "min(640px, 85%)",
          padding: "var(--omni-space-4)",
          borderTopRightRadius: isUser ? "var(--omni-radius-sm, 4px)" : undefined,
          borderTopLeftRadius: isUser ? undefined : "var(--omni-radius-sm, 4px)",
        }}
        aria-label={isUser ? "Your message" : "Assistant message"}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--omni-space-2)",
            marginBottom: "var(--omni-space-2)",
          }}
        >
          <span style={{ fontSize: "var(--omni-text-xs)", fontWeight: 600, opacity: 0.7 }}>
            {isUser ? "You" : "Assistant"}
          </span>
          {message.isOptimistic && (
            <Badge tone="neutral" aria-label="Sending">
              Sending…
            </Badge>
          )}
          {message.status === "incomplete" && !message.isStreaming && (
            <Badge tone="warning">Incomplete</Badge>
          )}
          {!message.isOptimistic && !message.isStreaming && (
            <span style={{ fontSize: "var(--omni-text-xs)", opacity: 0.5 }}>{formatTime(message.createdAt)}</span>
          )}
        </div>

        {isEmptyStreamingPlaceholder ? (
          <Spinner size="sm" label="Assistant is responding" />
        ) : isUser ? (
          <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.content}</p>
        ) : (
          <>
            <MarkdownMessage content={message.content} />
            {message.isStreaming && (
              <span aria-hidden="true" className="omni-chat-cursor">
                ▍
              </span>
            )}
          </>
        )}

        {canCopy && (
          <div className="omni-chat-bubble__actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={copied ? "Copied message" : "Copy message"}
              onClick={() => {
                void navigator.clipboard.writeText(message.content).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  },
                  () => {
                    // No destructive fallback — see the identical reasoning
                    // on the fenced-code-block copy button in MarkdownMessage.
                  },
                );
              }}
            >
              {copied ? "✓ Copied" : "⧉ Copy"}
            </Button>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
