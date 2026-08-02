import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, OmniscienceClient } from "@omniscience/sdk";
import type { Message, MessageStreamEvent } from "@omniscience/types";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { ConversationThread } from "./ConversationThread";

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

function renderThread(conversationId = "conversation_1") {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ConversationThread workspaceId={WORKSPACE_ID} conversationId={conversationId} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function userMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message_user_1",
    conversationId: "conversation_1",
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
    conversationId: "conversation_1",
    role: "assistant",
    content: "Hi!",
    createdAt: "2026-01-01T00:00:01.000Z",
    status: "complete",
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("ConversationThread", () => {
  it("shows a loading state before history resolves, then renders it", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    let resolveListMessages!: (value: unknown) => void;
    const listMessages = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveListMessages = resolve;
        }),
    );
    mockClient({ getMe, listMessages });
    renderThread();

    expect(screen.getByLabelText("Loading conversation")).toBeTruthy();
    resolveListMessages({ messages: [userMessage(), assistantMessage()], nextCursor: null });

    await waitFor(() => expect(screen.getByText("Hello")).toBeTruthy());
    expect(screen.getByText("Hi!")).toBeTruthy();
  });

  it("shows a recoverable error state with a working retry on history load failure", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listMessages = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError({ code: "NETWORK_ERROR", message: "down", status: 0 }))
      .mockResolvedValueOnce({ messages: [], nextCursor: null });
    mockClient({ getMe, listMessages });
    renderThread();

    await waitFor(() => expect(screen.getByText("Couldn't load this conversation")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("No messages yet")).toBeTruthy());
    expect(listMessages).toHaveBeenCalledTimes(2);
  });

  it("sends a message and streams the assistant reply incrementally end to end", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listMessages = vi.fn().mockResolvedValue({ messages: [], nextCursor: null });
    const events: MessageStreamEvent[] = [
      { event: "start", data: { userMessage: userMessage() } },
      { event: "delta", data: { text: "Hi " } },
      { event: "delta", data: { text: "there!" } },
      { event: "done", data: { assistantMessage: assistantMessage({ content: "Hi there!" }) } },
    ];
    const sendMessageStream = vi.fn().mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
    });
    mockClient({ getMe, listMessages, sendMessageStream });
    renderThread();

    await waitFor(() => expect(screen.getByText("No messages yet")).toBeTruthy());

    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("Sending…")).toBeTruthy();

    await waitFor(() => expect(screen.getByText("Hi there!")).toBeTruthy());
    expect(screen.queryByText("Sending…")).toBeNull();
    expect(sendMessageStream).toHaveBeenCalledWith(
      "access-token",
      WORKSPACE_ID,
      "conversation_1",
      "Hello",
      expect.anything(),
    );
  });

  it("shows an inline error with a retry action on a mid-stream error event", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listMessages = vi.fn().mockResolvedValue({ messages: [], nextCursor: null });
    const sendMessageStream = vi.fn().mockImplementation(async function* () {
      yield { event: "start", data: { userMessage: userMessage() } } as MessageStreamEvent;
      yield {
        event: "error",
        data: { code: "PROVIDER_UNAVAILABLE", message: "The provider failed." },
      } as MessageStreamEvent;
    });
    mockClient({ getMe, listMessages, sendMessageStream });
    renderThread();

    await waitFor(() => expect(screen.getByText("No messages yet")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("The provider failed.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByText("Incomplete")).toBeTruthy();
  });

  it("clears the previous conversation's messages immediately when switching conversations", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    let resolveSecond!: (value: unknown) => void;
    const listMessages = vi
      .fn()
      .mockResolvedValueOnce({ messages: [userMessage({ content: "From conversation one" })], nextCursor: null })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    mockClient({ getMe, listMessages });
    const { rerender } = renderThread("conversation_1");

    await waitFor(() => expect(screen.getByText("From conversation one")).toBeTruthy());

    rerender(
      <MemoryRouter>
        <AuthProvider>
          <ConversationThread workspaceId={WORKSPACE_ID} conversationId="conversation_2" />
        </AuthProvider>
      </MemoryRouter>,
    );

    // The old conversation's message must not linger while the new
    // conversation's history is still loading.
    expect(screen.queryByText("From conversation one")).toBeNull();

    resolveSecond({ messages: [userMessage({ content: "From conversation two" })], nextCursor: null });
    await waitFor(() => expect(screen.getByText("From conversation two")).toBeTruthy());
  });
});
