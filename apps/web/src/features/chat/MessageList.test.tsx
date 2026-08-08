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

  it("shows Regenerate only on the true last message, when it's a finished assistant reply", () => {
    const messages = [
      message({ id: "message_1", role: "user", content: "First" }),
      message({ id: "message_2", role: "assistant", content: "Second" }),
      message({ id: "message_3", role: "user", content: "Third" }),
      message({ id: "message_4", role: "assistant", content: "Fourth" }),
    ];
    render(<MessageList messages={messages} />);

    const regenerateButtons = screen.getAllByRole("button", { name: "Regenerate response" });
    expect(regenerateButtons).toHaveLength(1);
  });

  it("shows no Regenerate action when the conversation ends in a user message", () => {
    const messages = [
      message({ id: "message_1", role: "user", content: "First" }),
      message({ id: "message_2", role: "assistant", content: "Second" }),
      message({ id: "message_3", role: "user", content: "Third" }),
    ];
    render(<MessageList messages={messages} />);

    expect(screen.queryByRole("button", { name: "Regenerate response" })).toBeNull();
  });

  it("shows no Regenerate action while the last assistant message is still streaming", () => {
    const messages = [
      message({ id: "message_1", role: "user", content: "First" }),
      message({ id: "message_2", role: "assistant", content: "Still going", isStreaming: true }),
    ];
    render(<MessageList messages={messages} />);

    expect(screen.queryByRole("button", { name: "Regenerate response" })).toBeNull();
  });

  it("shows Edit only on the most recent user message, whether or not a reply follows it", () => {
    const messages = [
      message({ id: "message_1", role: "user", content: "First" }),
      message({ id: "message_2", role: "assistant", content: "Second" }),
      message({ id: "message_3", role: "user", content: "Third" }),
      message({ id: "message_4", role: "assistant", content: "Fourth" }),
    ];
    render(<MessageList messages={messages} />);

    const editButtons = screen.getAllByRole("button", { name: "Edit message" });
    expect(editButtons).toHaveLength(1);
  });

  it("shows Edit on the last user message when there is no assistant reply yet (failed/no-reply turn)", () => {
    const messages = [
      message({ id: "message_1", role: "user", content: "First" }),
      message({ id: "message_2", role: "assistant", content: "Second" }),
      message({ id: "message_3", role: "user", content: "Third, no reply yet" }),
    ];
    render(<MessageList messages={messages} />);

    expect(screen.getAllByRole("button", { name: "Edit message" })).toHaveLength(1);
  });

  it("shows no Edit action when the last user message is still optimistic", () => {
    const messages = [message({ id: "message_1", role: "user", content: "Sending", isOptimistic: true })];
    render(<MessageList messages={messages} />);

    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
  });

  it("shows neither action for an empty conversation", () => {
    render(<MessageList messages={[]} />);
    expect(screen.queryByRole("button", { name: "Regenerate response" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
  });

  it("forwards onRegenerate/onEditSave to the eligible bubbles", () => {
    const onRegenerate = vi.fn();
    const onEditSave = vi.fn();
    const messages = [
      message({ id: "message_1", role: "user", content: "First" }),
      message({ id: "message_2", role: "assistant", content: "Second" }),
    ];
    render(<MessageList messages={messages} onRegenerate={onRegenerate} onEditSave={onEditSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Regenerate response" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    fireEvent.change(screen.getByLabelText("Edit message content"), { target: { value: "Edited first" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onEditSave).toHaveBeenCalledWith("Edited first");
  });
});
