import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Button } from "@omniscience/ui";
import "./chat.css";

export interface ChatComposerProps {
  onSend: (content: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  /** Disables the composer entirely — e.g. while conversation history is still loading. */
  disabled?: boolean;
}

/**
 * A multiline, auto-growing `<textarea>`-based composer. There is no
 * multiline variant of `@omniscience/ui`'s `Input` (it wraps a plain
 * `<input>`), so this renders its own `<textarea>` — styled with the
 * same `omni-input` class the rest of the design system already uses
 * for form controls, plus a dedicated `omni-chat-composer__textarea`
 * class for the auto-grow sizing this needs that no other form field
 * does — rather than inventing new visual language.
 *
 * Grows with content up to a maximum height (`chat.css`'s `max-height`
 * on `.omni-chat-composer__textarea`), after which the textarea itself
 * scrolls instead of growing further. The surrounding
 * `.omni-chat-composer` surface adds `env(safe-area-inset-bottom)`
 * padding so the composer isn't crowded against the bottom edge on
 * devices with a home-indicator/notch safe area.
 */
export function ChatComposer({ onSend, onStop, isStreaming, disabled = false }: ChatComposerProps): JSX.Element {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = value.trim().length > 0 && !isStreaming && !disabled;

  // Auto-grow: reset to `auto` first so shrinking (e.g. after deleting a
  // line) is measured correctly, then size to the content's natural
  // height. `chat.css`'s `max-height` + `overflow-y: auto` on this same
  // element caps how tall this can actually get and takes over
  // scrolling beyond that point — this effect never needs to know the
  // cap itself.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function handleSend(): void {
    if (!canSend) return;
    onSend(value);
    setValue("");
    // Collapse back to one line immediately rather than waiting for the
    // next render's effect — avoids a one-frame flash of the old
    // (possibly multi-line) height with empty content inside it.
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="omni-chat-composer">
      <textarea
        ref={textareaRef}
        className="omni-input omni-chat-composer__textarea"
        placeholder="Message the assistant…"
        aria-label="Message"
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {isStreaming ? (
        <Button type="button" variant="secondary" onClick={onStop}>
          Stop
        </Button>
      ) : (
        <Button type="button" onClick={handleSend} disabled={!canSend}>
          Send
        </Button>
      )}
    </div>
  );
}
