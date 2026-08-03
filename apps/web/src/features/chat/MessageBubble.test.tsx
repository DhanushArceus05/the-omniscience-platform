import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
