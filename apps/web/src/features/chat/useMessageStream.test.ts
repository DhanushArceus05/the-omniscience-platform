import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, type OmniscienceClient } from "@omniscience/sdk";
import type { Message, MessageStreamEvent } from "@omniscience/types";
import { useMessageStream } from "./useMessageStream";

const WORKSPACE_ID = "workspace_1";
const CONVERSATION_ID = "conversation_1";
const ACCESS_TOKEN = "access-token";

function userMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message_user_1",
    conversationId: CONVERSATION_ID,
    role: "user",
    content: "Hello",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "complete",
    ...overrides,
  };
}

function assistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message_assistant_1",
    conversationId: CONVERSATION_ID,
    role: "assistant",
    content: "Hi there!",
    createdAt: "2026-01-01T00:00:01.000Z",
    status: "complete",
    ...overrides,
  };
}

/** Builds a fake `sendMessageStream` that yields the given events, honoring `signal` abortion between each yield. */
function fakeStream(events: MessageStreamEvent[], options: { throwAfter?: number } = {}) {
  return vi.fn().mockImplementation(async function* (
    _accessToken: string,
    _workspaceId: string,
    _conversationId: string,
    _content: string,
    streamOptions?: { signal?: AbortSignal },
  ) {
    for (let index = 0; index < events.length; index += 1) {
      if (streamOptions?.signal?.aborted) {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
      if (options.throwAfter === index) {
        throw new Error("connection dropped");
      }
      yield events[index];
      // Allow an in-flight `abort()` call (queued as a microtask by the
      // test) to land between yields, mirroring real network timing.
      await Promise.resolve();
    }
  });
}

function mockClient(sendMessageStream: ReturnType<typeof vi.fn>): OmniscienceClient {
  return { sendMessageStream } as unknown as OmniscienceClient;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMessageStream", () => {
  it("hydrates with persisted history", () => {
    const client = mockClient(fakeStream([]));
    const { result } = renderHook(() =>
      useMessageStream({ client, accessToken: ACCESS_TOKEN, workspaceId: WORKSPACE_ID, conversationId: CONVERSATION_ID }),
    );

    act(() => {
      result.current.hydrate([userMessage(), assistantMessage()]);
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]?.isOptimistic).toBeUndefined();
    expect(result.current.messages[1]?.isStreaming).toBeUndefined();
  });

  it("runs the full optimistic → start → delta* → done flow", async () => {
    const events: MessageStreamEvent[] = [
      { event: "start", data: { userMessage: userMessage() } },
      { event: "delta", data: { text: "Hi " } },
      { event: "delta", data: { text: "there!" } },
      { event: "done", data: { assistantMessage: assistantMessage() } },
    ];
    const client = mockClient(fakeStream(events));
    const { result } = renderHook(() =>
      useMessageStream({ client, accessToken: ACCESS_TOKEN, workspaceId: WORKSPACE_ID, conversationId: CONVERSATION_ID }),
    );

    act(() => {
      result.current.sendMessage("Hello");
    });

    // Optimistic user bubble appears immediately, before any network event.
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.isOptimistic).toBe(true);
    expect(result.current.isStreaming).toBe(true);

    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]?.isOptimistic).toBeUndefined();
    expect(result.current.messages[0]?.id).toBe("message_user_1");
    expect(result.current.messages[1]?.content).toBe("Hi there!");
    expect(result.current.messages[1]?.id).toBe("message_assistant_1");
    expect(result.current.messages[1]?.status).toBe("complete");
    expect(result.current.streamError).toBeNull();
  });

  it("keeps partial assistant text visible and marks it incomplete on a mid-stream error event", async () => {
    const events: MessageStreamEvent[] = [
      { event: "start", data: { userMessage: userMessage() } },
      { event: "delta", data: { text: "Partial reply" } },
      { event: "error", data: { code: "PROVIDER_UNAVAILABLE", message: "The provider failed." } },
    ];
    const client = mockClient(fakeStream(events));
    const { result } = renderHook(() =>
      useMessageStream({ client, accessToken: ACCESS_TOKEN, workspaceId: WORKSPACE_ID, conversationId: CONVERSATION_ID }),
    );

    act(() => {
      result.current.sendMessage("Hello");
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]?.content).toBe("Partial reply");
    expect(result.current.messages[1]?.status).toBe("incomplete");
    expect(result.current.messages[1]?.isStreaming).toBe(false);
    expect(result.current.streamError).toBe("The provider failed.");
  });

  it("removes the optimistic user message on a pre-stream ApiClientError, leaving no orphan", async () => {
    const sendMessageStream = vi.fn().mockImplementation(async function* () {
      // `yield*` over an empty iterable satisfies eslint's require-yield
      // without ever actually emitting an event — this generator must
      // still behave like the real `sendMessageStream`, which doesn't
      // run its body (and thus doesn't throw) until first iterated,
      // not the moment it's called.
      yield* [] as MessageStreamEvent[];
      throw new ApiClientError({ code: "CONVERSATION_NOT_FOUND", message: "Not found.", status: 404 });
    });
    const client = mockClient(sendMessageStream);
    const { result } = renderHook(() =>
      useMessageStream({ client, accessToken: ACCESS_TOKEN, workspaceId: WORKSPACE_ID, conversationId: CONVERSATION_ID }),
    );

    act(() => {
      result.current.sendMessage("Hello");
    });

    expect(result.current.messages).toHaveLength(1);

    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.streamError).toBe("That conversation could not be found.");
  });

  it("marks the assistant message incomplete (not an error) when the caller stops streaming", async () => {
    let resolveGate!: () => void;
    const sendMessageStream = vi.fn().mockImplementation(async function* (
      _accessToken: string,
      _workspaceId: string,
      _conversationId: string,
      _content: string,
      streamOptions?: { signal?: AbortSignal },
    ) {
      yield { event: "start", data: { userMessage: userMessage() } } as MessageStreamEvent;
      yield { event: "delta", data: { text: "Still going" } } as MessageStreamEvent;
      // Paused here until the test explicitly resolves it, so
      // `stopStreaming()` is guaranteed to run before the generator
      // could ever reach `done` — a purely microtask-driven fake
      // stream would race ahead of the test's `act()` calls instead.
      await new Promise<void>((resolve) => {
        resolveGate = resolve;
      });
      if (streamOptions?.signal?.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      yield { event: "done", data: { assistantMessage: assistantMessage({ content: "Should never arrive" }) } } as MessageStreamEvent;
    });
    const client = mockClient(sendMessageStream);
    const { result } = renderHook(() =>
      useMessageStream({ client, accessToken: ACCESS_TOKEN, workspaceId: WORKSPACE_ID, conversationId: CONVERSATION_ID }),
    );

    act(() => {
      result.current.sendMessage("Hello");
    });

    await waitFor(() => expect(result.current.messages[1]?.content).toBe("Still going"));

    act(() => {
      result.current.stopStreaming();
    });
    act(() => {
      resolveGate();
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    expect(result.current.messages[1]?.content).toBe("Still going");
    expect(result.current.messages[1]?.status).toBe("incomplete");
    expect(result.current.streamError).toBeNull();
  });

  it("ignores a stale in-flight stream after the conversation changes (generation guard)", async () => {
    let resolveDelta!: () => void;
    const sendMessageStream = vi.fn().mockImplementation(async function* (
      _accessToken: string,
      _workspaceId: string,
      _conversationId: string,
      _content: string,
      streamOptions?: { signal?: AbortSignal },
    ) {
      yield { event: "start", data: { userMessage: userMessage() } } as MessageStreamEvent;
      await new Promise<void>((resolve) => {
        resolveDelta = resolve;
      });
      if (streamOptions?.signal?.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      yield { event: "delta", data: { text: "late text" } } as MessageStreamEvent;
    });
    const client = mockClient(sendMessageStream);
    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string }) =>
        useMessageStream({ client, accessToken: ACCESS_TOKEN, workspaceId: WORKSPACE_ID, conversationId }),
      { initialProps: { conversationId: CONVERSATION_ID } },
    );

    act(() => {
      result.current.sendMessage("Hello");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    // Switch conversations while the stream is paused mid-flight — the
    // effect cleanup aborts the old controller and bumps the generation
    // counter.
    rerender({ conversationId: "conversation_2" });

    act(() => {
      resolveDelta();
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    // The stale `delta` must never have been applied to a hook instance
    // now scoped to a different conversation.
    expect(result.current.messages.some((message) => message.content === "late text")).toBe(false);
  });

  it("ignores a duplicate sendMessage call while already streaming", async () => {
    const events: MessageStreamEvent[] = [
      { event: "start", data: { userMessage: userMessage() } },
      { event: "done", data: { assistantMessage: assistantMessage() } },
    ];
    const sendMessageStream = fakeStream(events);
    const client = mockClient(sendMessageStream);
    const { result } = renderHook(() =>
      useMessageStream({ client, accessToken: ACCESS_TOKEN, workspaceId: WORKSPACE_ID, conversationId: CONVERSATION_ID }),
    );

    act(() => {
      result.current.sendMessage("First");
      result.current.sendMessage("Second");
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    expect(sendMessageStream).toHaveBeenCalledTimes(1);
    expect(sendMessageStream).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      WORKSPACE_ID,
      CONVERSATION_ID,
      "First",
      expect.anything(),
    );
  });

  it("retry() re-sends the last message's content", async () => {
    const failThenSucceed = vi
      .fn()
      .mockImplementationOnce(async function* () {
        yield* [] as MessageStreamEvent[];
        throw new ApiClientError({ code: "PROVIDER_UNAVAILABLE", message: "down", status: 503 });
      })
      .mockImplementationOnce(async function* () {
        yield { event: "start", data: { userMessage: userMessage() } } as MessageStreamEvent;
        yield { event: "done", data: { assistantMessage: assistantMessage() } } as MessageStreamEvent;
      });
    const client = mockClient(failThenSucceed);
    const { result } = renderHook(() =>
      useMessageStream({ client, accessToken: ACCESS_TOKEN, workspaceId: WORKSPACE_ID, conversationId: CONVERSATION_ID }),
    );

    act(() => {
      result.current.sendMessage("Hello");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(0));

    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    expect(failThenSucceed).toHaveBeenCalledTimes(2);
    expect(failThenSucceed).toHaveBeenNthCalledWith(
      2,
      ACCESS_TOKEN,
      WORKSPACE_ID,
      CONVERSATION_ID,
      "Hello",
      expect.anything(),
    );
    expect(result.current.messages).toHaveLength(2);
  });
});
