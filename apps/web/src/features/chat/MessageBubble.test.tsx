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

  it("preserves whitespace / line breaks as plain text (no markdown rendering)", () => {
    const content = "Line one\nLine two\n**not bold**";
    render(<MessageBubble message={{ ...BASE, role: "assistant", content }} />);
    const node = screen.getByText((_, element) => element?.textContent === content);
    expect(node).toBeTruthy();
    expect(node.tagName.toLowerCase()).toBe("p");
    expect((node as HTMLElement).style.whiteSpace).toBe("pre-wrap");
  });

  it("shows a 'Sending…' indicator for an optimistic message", () => {
    render(<MessageBubble message={{ ...BASE, isOptimistic: true }} />);
    expect(screen.getByText("Sending…")).toBeTruthy();
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
