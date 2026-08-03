import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { ChatMessage } from "./useMessageStream";

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message_1",
    conversationId: "conversation_1",
    role: "user",
    content: "Hello",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "complete",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("MessageList", () => {
  it("shows an empty state when there are no messages", () => {
    render(<MessageList messages={[]} />);
    expect(screen.getByText("No messages yet")).toBeTruthy();
  });

  it("renders every message in order", () => {
    const messages = [
      message({ id: "message_1", content: "First" }),
      message({ id: "message_2", role: "assistant", content: "Second" }),
      message({ id: "message_3", content: "Third" }),
    ];
    render(<MessageList messages={messages} />);

    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByText("Third")).toBeTruthy();
  });

  it("shows a 'Jump to latest' affordance once the user scrolls away from the bottom, and hides it again once they jump back", () => {
    const messages = [message({ id: "message_1", content: "First" })];
    const { rerender } = render(<MessageList messages={messages} />);

    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();

    const scrollRegion = screen.getByLabelText("Conversation messages");
    Object.defineProperty(scrollRegion, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollRegion, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(scrollRegion, "scrollTop", { value: 50, configurable: true, writable: true });
    fireEvent.scroll(scrollRegion);

    expect(screen.getByRole("button", { name: /Jump to latest/ })).toBeTruthy();

    // A new message (e.g. the next streamed delta) arrives while the
    // user is scrolled up — it must not be yanked back down, and the
    // affordance must still be showing rather than disappearing.
    rerender(<MessageList messages={[...messages, message({ id: "message_2", content: "Second" })]} />);
    expect(screen.getByRole("button", { name: /Jump to latest/ })).toBeTruthy();

    const scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    fireEvent.click(screen.getByRole("button", { name: /Jump to latest/ }));

    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();
  });
});
