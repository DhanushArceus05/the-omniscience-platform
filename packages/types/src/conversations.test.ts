import { describe, expect, it } from "vitest";
import type {
  Conversation,
  ListConversationsResponse,
  ListMessagesResponse,
  Message,
  SendMessageResponse,
} from "./conversations";

describe("conversation/message type shapes", () => {
  it("builds a valid Conversation value with a null title", () => {
    const conversation: Conversation = {
      id: "665f1c2b9a4e8f0012345678",
      workspaceId: "clx0000000000000000000000",
      title: null,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
    };

    expect(conversation.title).toBeNull();
    expect(conversation.id).toBe("665f1c2b9a4e8f0012345678");
  });

  it("builds a valid newest-first ListConversationsResponse page", () => {
    const response: ListConversationsResponse = {
      conversations: [
        {
          id: "665f1c2b9a4e8f0012345678",
          workspaceId: "clx0000000000000000000000",
          title: null,
          createdAt: "2026-07-28T00:00:00.000Z",
          updatedAt: "2026-07-28T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    };

    expect(response.conversations).toHaveLength(1);
    expect(response.nextCursor).toBeNull();
  });

  it("builds a valid user Message with no omniCore metadata", () => {
    const message: Message = {
      id: "665f1c2b9a4e8f0012345679",
      conversationId: "665f1c2b9a4e8f0012345678",
      role: "user",
      content: "Hello, OmniCore.",
      createdAt: "2026-07-28T00:00:00.000Z",
      status: "complete",
    };

    expect(message.role).toBe("user");
    expect(message.omniCore).toBeUndefined();
  });

  it("builds a valid assistant Message carrying trimmed omniCore metadata", () => {
    const message: Message = {
      id: "665f1c2b9a4e8f001234567a",
      conversationId: "665f1c2b9a4e8f0012345678",
      role: "assistant",
      content: "Hello! How can I help?",
      createdAt: "2026-07-28T00:00:01.000Z",
      status: "complete",
      omniCore: {
        planId: "plan_1",
        intent: "simple-generation",
        matchedRuleId: "fast-rule.simple-generation",
        confidence: 0.9,
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
        taskPlanId: "task-plan_1",
      },
    };

    expect(message.role).toBe("assistant");
    expect(message.omniCore?.providerId).toBe("anthropic");
  });

  it("builds a valid chronological ListMessagesResponse page", () => {
    const response: ListMessagesResponse = {
      messages: [
        {
          id: "665f1c2b9a4e8f0012345679",
          conversationId: "665f1c2b9a4e8f0012345678",
          role: "user",
          content: "Hello, OmniCore.",
          createdAt: "2026-07-28T00:00:00.000Z",
          status: "complete",
        },
      ],
      nextCursor: null,
    };

    expect(response.messages).toHaveLength(1);
  });

  it("builds a valid SendMessageResponse pairing a user message with its assistant reply", () => {
    const response: SendMessageResponse = {
      userMessage: {
        id: "665f1c2b9a4e8f0012345679",
        conversationId: "665f1c2b9a4e8f0012345678",
        role: "user",
        content: "Hello, OmniCore.",
        createdAt: "2026-07-28T00:00:00.000Z",
        status: "complete",
      },
      assistantMessage: {
        id: "665f1c2b9a4e8f001234567a",
        conversationId: "665f1c2b9a4e8f0012345678",
        role: "assistant",
        content: "Hello! How can I help?",
        createdAt: "2026-07-28T00:00:01.000Z",
        status: "complete",
        omniCore: {
          planId: "plan_1",
          intent: "simple-generation",
          matchedRuleId: "fast-rule.simple-generation",
          confidence: 0.9,
          providerId: "anthropic",
          modelId: "claude-sonnet-5",
          taskPlanId: "task-plan_1",
        },
      },
    };

    expect(response.userMessage.role).toBe("user");
    expect(response.assistantMessage.role).toBe("assistant");
  });

  it("builds a valid incomplete assistant Message — a stream cut short by cancellation or a provider failure (Phase 6 Step 2)", () => {
    const message: Message = {
      id: "665f1c2b9a4e8f001234567a",
      conversationId: "665f1c2b9a4e8f0012345678",
      role: "assistant",
      content: "This response was cut sh",
      createdAt: "2026-07-28T00:00:01.000Z",
      status: "incomplete",
    };

    expect(message.status).toBe("incomplete");
  });
});
