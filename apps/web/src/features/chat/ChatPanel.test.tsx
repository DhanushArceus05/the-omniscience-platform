import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
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
        <ChatPanel workspaceId={WORKSPACE_ID} initialConversationId={null} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Installs a `window.matchMedia` stub matching `ChatPanel`'s own
 * `COMPACT_CHAT_QUERY` (`max-width: 900px`), mirroring how
 * `AppShell.test.tsx` stubs its own breakpoint.
 */
function stubCompactChat(isCompact: boolean) {
  const mql = {
    matches: isCompact,
    media: "(max-width: 900px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
}

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
    expect(listMessages).toHaveBeenCalledWith("access-token", WORKSPACE_ID, "conversation_1", expect.anything());
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
      expect(listMessages).toHaveBeenCalledWith("access-token", WORKSPACE_ID, "conversation_new", expect.anything()),
    );
    expect(screen.getByText("No messages yet")).toBeTruthy();
  });

  it("restores the selected conversation from initialConversationId (Phase 6 Step 5 bugfix — surviving a page refresh)", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    const listMessages = vi.fn().mockResolvedValue({ messages: [userMessage("conversation_1")], nextCursor: null });
    mockClient({ getMe, listConversations, listMessages });

    render(
      <MemoryRouter initialEntries={[`/app/workspace/${WORKSPACE_ID}/chat/conversation_1`]}>
        <AuthProvider>
          <ChatPanel workspaceId={WORKSPACE_ID} initialConversationId="conversation_1" />
        </AuthProvider>
      </MemoryRouter>,
    );

    // The conversation's history loads immediately, without the user
    // having to click it in the sidebar first.
    await waitFor(() => expect(screen.getByText("Hello from conversation_1")).toBeTruthy());
    expect(screen.queryByText("Select a conversation")).toBeNull();
  });

  it("selecting a conversation updates the URL so a later refresh can restore it", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    const listMessages = vi.fn().mockResolvedValue({ messages: [userMessage("conversation_1")], nextCursor: null });
    mockClient({ getMe, listConversations, listMessages });

    function LocationProbe() {
      const location = useLocation();
      return <div data-testid="location-probe">{location.pathname}</div>;
    }

    render(
      <MemoryRouter initialEntries={[`/app/workspace/${WORKSPACE_ID}/chat`]}>
        <AuthProvider>
          <LocationProbe />
          <ChatPanel workspaceId={WORKSPACE_ID} initialConversationId={null} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByLabelText("Conversation list")).toBeTruthy());
    expect(screen.getByTestId("location-probe").textContent).toBe(`/app/workspace/${WORKSPACE_ID}/chat`);

    fireEvent.click(screen.getByRole("button", { name: /Conversation —/ }));

    await waitFor(() =>
      expect(screen.getByTestId("location-probe").textContent).toBe(
        `/app/workspace/${WORKSPACE_ID}/chat/conversation_1`,
      ),
    );
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

  it("deleting the currently-open conversation clears the active selection", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    const listMessages = vi.fn().mockResolvedValue({ messages: [], nextCursor: null });
    const deleteConversation = vi.fn().mockResolvedValue({ deleted: true });
    mockClient({ getMe, listConversations, listMessages, deleteConversation });
    renderPanel();

    await waitFor(() => expect(screen.getByLabelText("Conversation list")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Conversation —/ }));
    await waitFor(() => expect(screen.getByText("No messages yet")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Options for/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith("access-token", WORKSPACE_ID, "conversation_1"));
    await waitFor(() => expect(screen.getByText("Select a conversation")).toBeTruthy());
  });

  describe("compact layout (<=900px)", () => {
    it("shows no Conversations toggle on a normal/desktop width", async () => {
      stubCompactChat(false);
      seedSession();
      const getMe = vi.fn().mockResolvedValue(USER);
      const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
      mockClient({ getMe, listConversations });
      renderPanel();

      await waitFor(() => expect(listConversations).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: /Conversations/ })).toBeNull();
      // The single conversation list is still directly present (no overlay).
      expect(screen.getByLabelText("Conversation list")).toBeTruthy();
    });

    it("moves the conversation list into an off-canvas panel opened by a toggle, closable via Escape", async () => {
      stubCompactChat(true);
      seedSession();
      const getMe = vi.fn().mockResolvedValue(USER);
      const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
      mockClient({ getMe, listConversations });
      renderPanel();

      await waitFor(() => expect(listConversations).toHaveBeenCalled());
      const toggle = screen.getByRole("button", { name: /Conversations/ });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("dialog", { name: "Conversations" })).toBeTruthy();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(toggle);
    });

    it("closing the panel by selecting a conversation returns to a single, non-duplicated conversation list", async () => {
      stubCompactChat(true);
      seedSession();
      const getMe = vi.fn().mockResolvedValue(USER);
      const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
      const listMessages = vi.fn().mockResolvedValue({ messages: [], nextCursor: null });
      mockClient({ getMe, listConversations, listMessages });
      renderPanel();

      await waitFor(() => expect(listConversations).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("button", { name: /Conversations/ }));

      // Exactly one conversation list/button — never a second copy
      // duplicated between an inline layout and the drawer.
      expect(screen.getAllByLabelText("Conversation list")).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: /Conversation —/ }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getAllByLabelText("Conversation list")).toHaveLength(1);
    });
  });
});
