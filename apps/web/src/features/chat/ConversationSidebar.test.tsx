import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OmniscienceClient } from "@omniscience/sdk";
import type { Conversation } from "@omniscience/types";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { ConversationSidebar } from "./ConversationSidebar";

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
    title: "My conversation",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderSidebar(props: Partial<Parameters<typeof ConversationSidebar>[0]> = {}) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ConversationSidebar
          workspaceId={WORKSPACE_ID}
          activeConversationId={null}
          onSelect={vi.fn()}
          onCreated={vi.fn()}
          onDeleted={vi.fn()}
          {...props}
        />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("ConversationSidebar", () => {
  it("renames a conversation via the row menu, Enter to commit", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    const renamed = conversation({ title: "New title" });
    const renameConversation = vi.fn().mockResolvedValue(renamed);
    mockClient({ getMe, listConversations, renameConversation });
    renderSidebar();

    await waitFor(() => expect(screen.getByText("My conversation")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Options for My conversation" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByLabelText("Conversation title") as HTMLInputElement;
    expect(input.value).toBe("My conversation");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(renameConversation).toHaveBeenCalledWith("access-token", WORKSPACE_ID, "conversation_1", "New title"),
    );
    await waitFor(() => expect(screen.getByText("New title")).toBeTruthy());
  });

  it("cancels a rename via Escape, leaving the title and the server untouched", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    const renameConversation = vi.fn();
    mockClient({ getMe, listConversations, renameConversation });
    renderSidebar();

    await waitFor(() => expect(screen.getByText("My conversation")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Options for My conversation" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByLabelText("Conversation title");
    fireEvent.change(input, { target: { value: "Abandoned edit" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByLabelText("Conversation title")).toBeNull();
    expect(screen.getByText("My conversation")).toBeTruthy();
    expect(renameConversation).not.toHaveBeenCalled();
  });

  it("cancelling the delete confirmation does not delete the conversation", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    const deleteConversation = vi.fn();
    mockClient({ getMe, listConversations, deleteConversation });
    renderSidebar();

    await waitFor(() => expect(screen.getByText("My conversation")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Options for My conversation" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.getByText("Delete conversation?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Delete conversation?")).toBeNull();
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(screen.getByText("My conversation")).toBeTruthy();
  });

  it("confirming delete removes the conversation and calls onDeleted", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    const deleteConversation = vi.fn().mockResolvedValue({ deleted: true });
    mockClient({ getMe, listConversations, deleteConversation });
    const onDeleted = vi.fn();
    renderSidebar({ onDeleted });

    await waitFor(() => expect(screen.getByText("My conversation")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Options for My conversation" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deleteConversation).toHaveBeenCalledWith("access-token", WORKSPACE_ID, "conversation_1"),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("conversation_1"));
    expect(screen.getByText("No conversations yet")).toBeTruthy();
  });

  it("does not call onDeleted when the delete request fails", async () => {
    seedSession();
    const { ApiClientError } = await import("@omniscience/sdk");
    const getMe = vi.fn().mockResolvedValue(USER);
    const listConversations = vi.fn().mockResolvedValue({ conversations: [conversation()], nextCursor: null });
    const deleteConversation = vi
      .fn()
      .mockRejectedValue(new ApiClientError({ code: "CONVERSATION_NOT_FOUND", message: "gone", status: 404 }));
    mockClient({ getMe, listConversations, deleteConversation });
    const onDeleted = vi.fn();
    renderSidebar({ onDeleted });

    await waitFor(() => expect(screen.getByText("My conversation")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Options for My conversation" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalled());
    expect(onDeleted).not.toHaveBeenCalled();
    // Rolled back — still visible after the failed delete.
    await waitFor(() => expect(screen.getByText("My conversation")).toBeTruthy());
  });
});
