import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, OmniscienceClient } from "@omniscience/sdk";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { SessionsSection } from "./SessionsSection";

vi.mock("@omniscience/sdk", async () => {
  const actual = await vi.importActual<typeof import("@omniscience/sdk")>("@omniscience/sdk");
  return { ...actual, OmniscienceClient: vi.fn() };
});

const mockedClientCtor = vi.mocked(OmniscienceClient);

function mockClient(overrides: Record<string, ReturnType<typeof vi.fn>>) {
  mockedClientCtor.mockImplementation(() => overrides as unknown as OmniscienceClient);
}

const STORAGE_KEY = "omniscience.auth.session";
const USER = { id: "user-1", email: "person@example.com", name: "Person Name", avatarUrl: null };

function seedSession() {
  const session = {
    accessToken: "access-token",
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(Date.now() + 604_800_000).toISOString(),
    user: USER,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function renderSessions() {
  return render(
    <AuthProvider>
      <SessionsSection />
    </AuthProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

const sessions = [
  { tokenId: "token_2", createdAt: "2026-01-02T00:00:00.000Z" },
  { tokenId: "token_1", createdAt: "2026-01-01T00:00:00.000Z" },
];

describe("SessionsSection", () => {
  it("shows a loading state before the list resolves, then never leaves it stuck", async () => {
    seedSession();
    let resolveList!: (value: unknown) => void;
    const listSessions = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), listSessions });
    renderSessions();

    expect(screen.getByLabelText("Loading your sessions")).toBeTruthy();
    resolveList([]);

    await waitFor(() => expect(screen.getByText("No active sessions found.")).toBeTruthy());
    expect(screen.queryByLabelText("Loading your sessions")).toBeNull();
  });

  it("renders the session list", async () => {
    seedSession();
    const listSessions = vi.fn().mockResolvedValue(sessions);
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), listSessions });
    renderSessions();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Sign out of all other sessions" })).toBeTruthy();
  });

  it("shows a recoverable error state with a working retry, and never gets stuck loading", async () => {
    seedSession();
    const listSessions = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError({ code: "NETWORK_ERROR", message: "down", status: 0 }),
      )
      .mockResolvedValueOnce(sessions);
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), listSessions });
    renderSessions();

    await waitFor(() => expect(screen.getByText("Couldn't load your sessions")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(2));
  });

  it("revokes an individual session and removes it from the list", async () => {
    seedSession();
    const listSessions = vi.fn().mockResolvedValue(sessions);
    const revokeSession = vi.fn().mockResolvedValue({ revoked: true });
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), listSessions, revokeSession });
    renderSessions();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1));
    expect(revokeSession).toHaveBeenCalledWith("access-token", "token_2");
  });

  it("signs out of all other sessions and reloads the list", async () => {
    seedSession();
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce(sessions)
      .mockResolvedValueOnce([sessions[1]]);
    const revokeAllSessions = vi.fn().mockResolvedValue({ revokedCount: 1 });
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), listSessions, revokeAllSessions });
    renderSessions();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Sign out of all other sessions" }));

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1));
    expect(revokeAllSessions).toHaveBeenCalledWith("access-token");
  });

  it("shows a visible error when revoking a session fails, without removing it from the list", async () => {
    seedSession();
    const listSessions = vi.fn().mockResolvedValue(sessions);
    const revokeSession = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ code: "SESSION_NOT_FOUND", message: "gone", status: 404 }),
      );
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), listSessions, revokeSession });
    renderSessions();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);

    await waitFor(() =>
      expect(
        screen.getByText("That session could not be found — it may already be signed out."),
      ).toBeTruthy(),
    );
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(2);
  });
});
