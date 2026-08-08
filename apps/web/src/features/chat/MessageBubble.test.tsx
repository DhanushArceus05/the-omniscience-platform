import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageBubble } from "./MessageBubble";
import type { ChatMessage } from "./useMessageStream";

const BASE: ChatMessage = {
  id: "message_1",
  conversationId: "conversation_1",
  role: "user",
  content: "Hello there",
  createdAt: "2026-01-01T12:00:00.000Z",
  status: "complete",
};

afterEach(() => {
  cleanup();
});

describe("MessageBubble", () => {
  it("renders user message content with the 'You' label", () => {
    render(<MessageBubble message={BASE} />);
    expect(screen.getByText("Hello there")).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("renders assistant message content with the 'Assistant' label", () => {
    render(<MessageBubble message={{ ...BASE, role: "assistant", content: "Hi!" }} />);
    expect(screen.getByText("Hi!")).toBeTruthy();
    expect(screen.getByText("Assistant")).toBeTruthy();
  });

  it("preserves whitespace / line breaks as plain text for a USER message (no markdown rendering)", () => {
    const content = "Line one\nLine two\n**not bold**";
    render(<MessageBubble message={{ ...BASE, content }} />);
    const node = screen.getByText((_, element) => element?.textContent === content);
    expect(node).toBeTruthy();
    expect(node.tagName.toLowerCase()).toBe("p");
    expect((node as HTMLElement).style.whiteSpace).toBe("pre-wrap");
  });

  it("renders ASSISTANT message content as real Markdown, not raw syntax", () => {
    render(
      <MessageBubble
        message={{ ...BASE, role: "assistant", content: "**bold** and *italic* and `inline code`" }}
      />,
    );
    // The raw syntax characters must not appear literally in the output.
    expect(screen.queryByText("**bold**", { exact: false })).toBeNull();
    const bold = screen.getByText("bold");
    expect(bold.tagName.toLowerCase()).toBe("strong");
    const italic = screen.getByText("italic");
    expect(italic.tagName.toLowerCase()).toBe("em");
    const code = screen.getByText("inline code");
    expect(code.tagName.toLowerCase()).toBe("code");
  });

  it("renders a fenced code block with a language label and a copy button", () => {
    render(
      <MessageBubble
        message={{ ...BASE, role: "assistant", content: "```ts\nconst x = 1;\n```" }}
      />,
    );
    expect(screen.getByText("ts")).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.tagName.toLowerCase() === "code" && Boolean(el.textContent?.trim() === "const x = 1;")),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
  });

  it("renders a Markdown link with a safe http(s) href and target=_blank/rel=noopener", () => {
    render(
      <MessageBubble
        message={{ ...BASE, role: "assistant", content: "[Anthropic](https://www.anthropic.com)" }}
      />,
    );
    const link = screen.getByRole("link", { name: "Anthropic" });
    expect(link.getAttribute("href")).toBe("https://www.anthropic.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("strips an unsafe (javascript:) link scheme instead of rendering it as a clickable link", () => {
    render(
      <MessageBubble
        message={{ ...BASE, role: "assistant", content: "[click me](javascript:alert(1))" }}
      />,
    );
    expect(screen.queryByRole("link", { name: "click me" })).toBeNull();
    expect(screen.getByText("click me")).toBeTruthy();
  });

  it("does not crash on a partially-streamed, unterminated Markdown construct", () => {
    render(
      <MessageBubble
        message={{ ...BASE, role: "assistant", content: "Here is **bold text that never clos", isStreaming: true }}
      />,
    );
    expect(screen.getByText(/bold text that never clos/)).toBeTruthy();
  });

  it("shows a 'Sending…' indicator for an optimistic message", () => {
    render(<MessageBubble message={{ ...BASE, isOptimistic: true }} />);
    expect(screen.getByText("Sending…")).toBeTruthy();
  });

  it("shows a whole-message copy action for a finished assistant message, but not while streaming or for a user message", () => {
    const { rerender } = render(
      <MessageBubble message={{ ...BASE, role: "assistant", content: "done", isStreaming: false }} />,
    );
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();

    rerender(<MessageBubble message={{ ...BASE, role: "assistant", content: "still going", isStreaming: true }} />);
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();

    rerender(<MessageBubble message={{ ...BASE, role: "user", content: "hi", isStreaming: false }} />);
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
  });

  it("shows an 'Incomplete' badge for a finished-but-incomplete assistant message", () => {
    render(
      <MessageBubble
        message={{ ...BASE, role: "assistant", content: "cut off", status: "incomplete", isStreaming: false }}
      />,
    );
    expect(screen.getByText("Incomplete")).toBeTruthy();
  });

  it("shows a loading spinner instead of the incomplete badge while actively streaming with no text yet", () => {
    render(
      <MessageBubble message={{ ...BASE, role: "assistant", content: "", status: "incomplete", isStreaming: true }} />,
    );
    expect(screen.getByLabelText("Assistant is responding")).toBeTruthy();
    expect(screen.queryByText("Incomplete")).toBeNull();
  });

  it("shows Regenerate only for an assistant message with canRegenerate=true", () => {
    const { rerender } = render(
      <MessageBubble message={{ ...BASE, role: "assistant", content: "done" }} canRegenerate />,
    );
    expect(screen.getByRole("button", { name: "Regenerate response" })).toBeTruthy();

    rerender(<MessageBubble message={{ ...BASE, role: "assistant", content: "done" }} canRegenerate={false} />);
    expect(screen.queryByRole("button", { name: "Regenerate response" })).toBeNull();
  });

  it("never shows Regenerate for a user message, even if canRegenerate is somehow true", () => {
    render(<MessageBubble message={{ ...BASE, role: "user" }} canRegenerate />);
    expect(screen.queryByRole("button", { name: "Regenerate response" })).toBeNull();
  });

  it("calls onRegenerate when the Regenerate button is clicked", () => {
    const onRegenerate = vi.fn();
    render(
      <MessageBubble
        message={{ ...BASE, role: "assistant", content: "done" }}
        canRegenerate
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Regenerate response" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("shows Edit only for a user message with canEdit=true", () => {
    const { rerender } = render(<MessageBubble message={{ ...BASE, role: "user" }} canEdit />);
    expect(screen.getByRole("button", { name: "Edit message" })).toBeTruthy();

    rerender(<MessageBubble message={{ ...BASE, role: "user" }} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
  });

  it("never shows Edit for an assistant message, even if canEdit is somehow true", () => {
    render(<MessageBubble message={{ ...BASE, role: "assistant", content: "hi" }} canEdit />);
    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
  });

  it("clicking Edit switches to inline editing pre-filled with the current content", () => {
    render(<MessageBubble message={{ ...BASE, role: "user", content: "original text" }} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));

    const input = screen.getByLabelText("Edit message content") as HTMLInputElement;
    expect(input.value).toBe("original text");
  });

  it("Save commits the edited content via onEditSave", () => {
    const onEditSave = vi.fn();
    render(
      <MessageBubble message={{ ...BASE, role: "user", content: "original" }} canEdit onEditSave={onEditSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    const input = screen.getByLabelText("Edit message content");
    fireEvent.change(input, { target: { value: "edited text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onEditSave).toHaveBeenCalledWith("edited text");
    expect(screen.queryByLabelText("Edit message content")).toBeNull();
  });

  it("Enter commits the edited content", () => {
    const onEditSave = vi.fn();
    render(
      <MessageBubble message={{ ...BASE, role: "user", content: "original" }} canEdit onEditSave={onEditSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    const input = screen.getByLabelText("Edit message content");
    fireEvent.change(input, { target: { value: "edited via enter" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEditSave).toHaveBeenCalledWith("edited via enter");
  });

  it("Cancel restores the original text without calling onEditSave", () => {
    const onEditSave = vi.fn();
    render(
      <MessageBubble message={{ ...BASE, role: "user", content: "original" }} canEdit onEditSave={onEditSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    fireEvent.change(screen.getByLabelText("Edit message content"), { target: { value: "abandoned edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onEditSave).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Edit message content")).toBeNull();
    expect(screen.getByText("original")).toBeTruthy();
  });

  it("Escape cancels the edit without calling onEditSave", () => {
    const onEditSave = vi.fn();
    render(
      <MessageBubble message={{ ...BASE, role: "user", content: "original" }} canEdit onEditSave={onEditSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    const input = screen.getByLabelText("Edit message content");
    fireEvent.change(input, { target: { value: "abandoned edit" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onEditSave).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Edit message content")).toBeNull();
    expect(screen.getByText("original")).toBeTruthy();
  });

  it("treats an empty edit as a cancel rather than calling onEditSave", () => {
    const onEditSave = vi.fn();
    render(
      <MessageBubble message={{ ...BASE, role: "user", content: "original" }} canEdit onEditSave={onEditSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    fireEvent.change(screen.getByLabelText("Edit message content"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onEditSave).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Edit message content")).toBeNull();
  });
});
