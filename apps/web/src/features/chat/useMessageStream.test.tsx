import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@omniscience/types";
import { useMessageStream } from "./useMessageStream";

const user: Message = { id: "user-1", conversationId: "conversation-1", workspaceId: "workspace-1", ownerId: "owner-1", role: "user", content: "Question", createdAt: "2026-01-01T00:00:00.000Z", status: "complete", requestId: "stable-request-id", knowledgeRequested: true };
const assistant: Message = { id: "assistant-1", conversationId: "conversation-1", workspaceId: "workspace-1", ownerId: "owner-1", role: "assistant", content: "Answer", createdAt: "2026-01-01T00:00:01.000Z", status: "complete" };

describe("useMessageStream Knowledge retry handling", () => {
  it("keeps the persisted user turn, removes the assistant placeholder, stops loading, and retries with the same key without duplicating the user", async () => {
    const calls: unknown[][] = [];
    const client = {
      sendMessageStream: vi.fn((_token: string, _workspace: string, _conversation: string, _content: string, options: unknown) => {
        calls.push([options]);
        const attempt = calls.length;
        return (async function* () {
          yield { event: "start", data: { userMessage: user, ...(attempt === 1 ? { assistantExpected: false } : {}) } };
          if (attempt === 1) yield { event: "error", data: { code: "KNOWLEDGE_RETRIEVAL_UNAVAILABLE", message: "Retrieval failed", assistantMessagePersisted: false, retryable: true } };
          else {
            yield { event: "delta", data: { text: "Answer" } };
            yield { event: "done", data: { assistantMessage: assistant } };
          }
        })();
      }),
    };
    const { result } = renderHook(() => useMessageStream({ client: client as never, accessToken: "token", workspaceId: "workspace-1", conversationId: "conversation-1" }));
    act(() => result.current.sendMessage("Question", true));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.messages.map((message) => message.role)).toEqual(["user"]);
    expect(result.current.messages[0]?.id).toBe("user-1");
    expect(result.current.streamError).toBe("Retrieval failed");

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(client.sendMessageStream).toHaveBeenCalledTimes(2);
    const firstOptions = calls[0]?.[0] as { requestId: string };
    const secondOptions = calls[1]?.[0] as { requestId: string };
    expect(secondOptions.requestId).toBe(firstOptions.requestId);
    expect(result.current.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(result.current.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.current.streamError).toBeNull();
  });
});
