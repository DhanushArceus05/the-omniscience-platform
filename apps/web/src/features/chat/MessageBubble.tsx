import { useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Badge, Button, GlassCard, Input, Spinner } from "@omniscience/ui";
import { MarkdownMessage } from "./MarkdownMessage";
import type { ChatMessage } from "./useMessageStream";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export interface MessageBubbleProps {
  message: ChatMessage;
  /** Phase 6 Step 5 — Message-Level UX. True only for the conversation's true final message, and only when it's a finished assistant reply — computed by `MessageList`. */
  canRegenerate?: boolean;
  /** Phase 6 Step 5 — Message-Level UX. True only for the conversation's most recent user message — computed by `MessageList`. */
  canEdit?: boolean;
  onRegenerate?: () => void;
  onEditSave?: (newContent: string) => void;
}

/**
 * Renders one `ChatMessage`. Assistant content is rendered as real
 * Markdown (`MarkdownMessage`) — headings, emphasis, lists, code
 * blocks, tables, links, etc. — rather than shown as raw `**`/`#`/`-`
 * syntax. User messages stay plain preformatted text
 * (`white-space: pre-wrap`): a person's own typed input shouldn't be
 * reinterpreted as Markdown they didn't necessarily intend as such.
 *
 * Phase 6 Step 5 adds two message-level actions, both gated by
 * eligibility booleans `MessageList` computes (never decided here) —
 * "Regenerate" on the one eligible assistant bubble, and inline
 * "Edit" on the one eligible user bubble, mirroring
 * `ConversationSidebar`'s existing inline-rename interaction (an
 * `Input` swapped in for the static text, Enter/Save commits,
 * Escape/Cancel restores, no new UI pattern introduced). Both actions
 * are display-only conveniences — the backend independently
 * re-verifies eligibility (the true last message) on every delete
 * call, so a stale `canRegenerate`/`canEdit` here can never cause an
 * unintended deletion, only a rejected one.
 */
export function MessageBubble({
  message,
  canRegenerate,
  canEdit,
  onRegenerate,
  onEditSave,
}: MessageBubbleProps): JSX.Element {
  const isUser = message.role === "user";
  const isEmptyStreamingPlaceholder = message.isStreaming && message.content.length === 0;
  const [copied, setCopied] = useState(false);
  const canCopy = !isUser && !message.isStreaming && message.content.length > 0;

  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  function startEdit(): void {
    setEditDraft(message.content);
    setIsEditing(true);
    // Focus after the input has actually mounted.
    requestAnimationFrame(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    });
  }

  function cancelEdit(): void {
    setIsEditing(false);
    setEditDraft("");
  }

  function commitEdit(): void {
    const trimmed = editDraft.trim();
    // An empty draft is a cancel, not a rejected submission — same
    // reasoning `ConversationSidebar.commitRename()` already documents
    // for its own inline edit.
    if (!trimmed) {
      cancelEdit();
      return;
    }
    setIsEditing(false);
    onEditSave?.(trimmed);
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  }

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

        {isEditing ? (
          <div>
            <Input
              ref={editInputRef}
              aria-label="Edit message content"
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              onKeyDown={handleEditKeyDown}
            />
            <div className="omni-chat-bubble__actions" style={{ opacity: 1 }}>
              <Button type="button" variant="secondary" size="sm" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={commitEdit}>
                Save
              </Button>
            </div>
          </div>
        ) : isEmptyStreamingPlaceholder ? (
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

        {!isEditing && (canCopy || (isUser && canEdit) || (!isUser && canRegenerate)) && (
          <div className="omni-chat-bubble__actions">
            {canCopy && (
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
            )}
            {!isUser && canRegenerate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Regenerate response"
                onClick={() => onRegenerate?.()}
              >
                ↻ Regenerate
              </Button>
            )}
            {isUser && canEdit && (
              <Button type="button" variant="ghost" size="sm" aria-label="Edit message" onClick={startEdit}>
                ✎ Edit
              </Button>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
