import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, type OmniscienceClient } from "@omniscience/sdk";
import type { Conversation } from "@omniscience/types";
import { useConversations } from "./useConversations";

const WORKSPACE_ID = "workspace_1";
const ACCESS_TOKEN = "access-token";

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conversation_1",
    workspaceId: WORKSPACE_ID,
    title: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useConversations", () => {
  it("starts in a loading phase and transitions to ready with the loaded list", async () => {
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    const client = { listConversations } as unknown as OmniscienceClient;

    const { result } = renderHook(() => useConversations(client, ACCESS_TOKEN, WORKSPACE_ID));

    expect(result.current.state.phase).toBe("loading");
    await waitFor(() => expect(result.current.state.phase).toBe("ready"));
    expect(result.current.state.phase === "ready" && result.current.state.conversations).toHaveLength(1);
    expect(listConversations).toHaveBeenCalledWith(ACCESS_TOKEN, WORKSPACE_ID);
  });

  it("surfaces a recoverable error state on load failure", async () => {
    const listConversations = vi
      .fn()
      .mockRejectedValue(new ApiClientError({ code: "NETWORK_ERROR", message: "down", status: 0 }));
    const client = { listConversations } as unknown as OmniscienceClient;

    const { result } = renderHook(() => useConversations(client, ACCESS_TOKEN, WORKSPACE_ID));
    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    expect(result.current.state.phase === "error" && result.current.state.message).toBe(
      "Could not reach the server. Check your connection and try again.",
    );
  });

  it("resolves to an empty ready list when the workspace has no conversations", async () => {
    const listConversations = vi.fn().mockResolvedValue({ conversations: [], nextCursor: null });
    const client = { listConversations } as unknown as OmniscienceClient;

    const { result } = renderHook(() => useConversations(client, ACCESS_TOKEN, WORKSPACE_ID));
    await waitFor(() => expect(result.current.state.phase).toBe("ready"));
    expect(result.current.state.phase === "ready" && result.current.state.conversations).toHaveLength(0);
  });

  it("prepends a newly created conversation without re-fetching the list", async () => {
    const existing = conversation({ id: "conversation_old" });
    const created = conversation({ id: "conversation_new" });
    const listConversations = vi.fn().mockResolvedValue({ conversations: [existing], nextCursor: null });
    const createConversationMock = vi.fn().mockResolvedValue(created);
    const client = {
      listConversations,
      createConversation: createConversationMock,
    } as unknown as OmniscienceClient;

    const { result } = renderHook(() => useConversations(client, ACCESS_TOKEN, WORKSPACE_ID));
    await waitFor(() => expect(result.current.state.phase).toBe("ready"));

    let returned: Conversation | null = null;
    await act(async () => {
      returned = await result.current.createConversation();
    });

    expect(returned).toEqual(created);
    expect(listConversations).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase === "ready" && result.current.state.conversations.map((c) => c.id)).toEqual([
      "conversation_new",
      "conversation_old",
    ]);
  });

  it("surfaces a create error without disturbing the existing list", async () => {
    const existing = conversation({ id: "conversation_old" });
    const listConversations = vi.fn().mockResolvedValue({ conversations: [existing], nextCursor: null });
    const createConversationMock = vi
      .fn()
      .mockRejectedValue(new ApiClientError({ code: "RATE_LIMITED", message: "slow down", status: 429 }));
    const client = {
      listConversations,
      createConversation: createConversationMock,
    } as unknown as OmniscienceClient;

    const { result } = renderHook(() => useConversations(client, ACCESS_TOKEN, WORKSPACE_ID));
    await waitFor(() => expect(result.current.state.phase).toBe("ready"));

    let returned: Conversation | null = existing;
    await act(async () => {
      returned = await result.current.createConversation();
    });

    expect(returned).toBeNull();
    expect(result.current.createError).toBe("You're sending messages too quickly. Please wait a moment and try again.");
    expect(result.current.state.phase === "ready" && result.current.state.conversations).toHaveLength(1);
  });
});
