import { useState, type JSX, type KeyboardEvent } from "react";
import { Button } from "@omniscience/ui";

export interface ChatComposerProps {
  onSend: (content: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  /** Disables the composer entirely — e.g. while conversation history is still loading. */
  disabled?: boolean;
}

/**
 * A multiline `<textarea>`-based composer. There is no multiline
 * variant of `@omniscience/ui`'s `Input` (it wraps a plain
 * `<input>`), so this renders its own `<textarea>` styled with the
 * same `omni-input` class the rest of the design system already uses
 * for form controls, rather than inventing new visual language.
 */
export function ChatComposer({ onSend, onStop, isStreaming, disabled = false }: ChatComposerProps): JSX.Element {
  const [value, setValue] = useState("");

  const canSend = value.trim().length > 0 && !isStreaming && !disabled;

  function handleSend(): void {
    if (!canSend) return;
    onSend(value);
    setValue("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div style={{ display: "flex", gap: "var(--omni-space-3)", alignItems: "flex-end" }}>
      <textarea
        className="omni-input"
        style={{ flex: 1, resize: "vertical", minHeight: "2.75rem", maxHeight: "10rem" }}
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
