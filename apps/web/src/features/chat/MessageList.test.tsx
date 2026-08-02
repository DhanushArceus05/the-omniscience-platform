import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
