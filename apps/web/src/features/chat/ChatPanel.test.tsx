import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OmniscienceClient } from "@omniscience/sdk";
import type { Conversation, Message, MessageStreamEvent } from "@omniscience/types";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { ChatPanel } from "./ChatPanel";

vi.mock("@omniscience/sdk", async () => {
  const actual = await vi.importActual<typeof import("@omniscience/sdk")>("@omniscience/sdk");
  return {
    ...actual,
    OmniscienceClient: vi.fn(),
  };
});

const mockedClientCtor = vi.mocked(OmniscienceClient);

function mockClient(overrides: Record<string, ReturnType<typeof vi.fn>>) {
  mockedClientCtor.mockImplementation(() => overrides as unknown as OmniscienceClient);
}

const STORAGE_KEY = "omniscience.auth.session";
const USER = { id: "user-1", email: "person@example.com", name: "Person Name" };
const WORKSPACE_ID = "workspace_1";

function seedSession() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      accessToken: "access-token",
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: new Date(Date.now() + 604_800_000).toISOString(),
      user: USER,
    }),
  );
}

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

function userMessage(conversationId: string): Message {
  return {
    id: `message_user_${conversationId}`,
    conversationId,
    role: "user",
    content: `Hello from ${conversationId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "complete",
  };
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ChatPanel workspaceId={WORKSPACE_ID} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("ChatPanel", () => {
  it("shows a prompt to select a conversation before any is active", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    mockClient({ getMe, listConversations });
    renderPanel();

    await waitFor(() => expect(listConversations).toHaveBeenCalled());
    expect(screen.getByText("Select a conversation")).toBeTruthy();
  });

  it("loads and displays a conversation's history when selected from the sidebar", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    const listMessages = vi.fn().mockResolvedValue({ messages: [userMessage("conversation_1")], nextCursor: null });
    mockClient({ getMe, listConversations, listMessages });
    renderPanel();

    await waitFor(() => expect(screen.getByLabelText("Conversation list")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Conversation —/ }));

    await waitFor(() => expect(screen.getByText("Hello from conversation_1")).toBeTruthy());
    expect(listMessages).toHaveBeenCalledWith("access-token", WORKSPACE_ID, "conversation_1");
  });

  it("creating a new conversation makes it active immediately", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [], nextCursor: null });
    const created = conversation({ id: "conversation_new" });
    const createConversation = vi.fn().mockResolvedValue(created);
    const listMessages = vi.fn().mockResolvedValue({ messages: [], nextCursor: null });
    mockClient({ getMe, listConversations, createConversation, listMessages });
    renderPanel();

    await waitFor(() => expect(screen.getByText("No conversations yet")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));

    await waitFor(() =>
      expect(listMessages).toHaveBeenCalledWith("access-token", WORKSPACE_ID, "conversation_new"),
    );
    expect(screen.getByText("No messages yet")).toBeTruthy();
  });

  it("switching to another conversation aborts the previous conversation's in-flight stream", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const conversationOne = conversation({ id: "conversation_1" });
    const conversationTwo = conversation({ id: "conversation_2", createdAt: "2026-01-02T00:00:00.000Z" });
    const listConversations = vi
      .fn()
      .mockResolvedValue({ conversations: [conversationTwo, conversationOne], nextCursor: null });
    const listMessages = vi.fn().mockResolvedValue({ messages: [], nextCursor: null });

    let firstStreamAborted = false;
    const sendMessageStream = vi.fn().mockImplementation(async function* (
      _accessToken: string,
      _workspaceId: string,
      _conversationId: string,
      _content: string,
      options?: { signal?: AbortSignal },
    ) {
      yield { event: "start", data: { userMessage: userMessage("conversation_1") } } as MessageStreamEvent;
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener("abort", () => {
          firstStreamAborted = true;
          resolve();
        });
      });
      if (options?.signal?.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
    });

    mockClient({ getMe, listConversations, listMessages, sendMessageStream });
    renderPanel();

    await waitFor(() => expect(screen.getByLabelText("Conversation list")).toBeTruthy());
    const buttons = screen.getAllByRole("button", { name: /Conversation —/ });
    fireEvent.click(buttons[0]!); // most-recent (conversation_2) — newest-first list order

    await waitFor(() => expect(screen.getByText("No messages yet")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessageStream).toHaveBeenCalledTimes(1));

    // Switch to the other conversation while the first is still streaming.
    fireEvent.click(buttons[1]!);

    await waitFor(() => expect(firstStreamAborted).toBe(true));
  });
});
