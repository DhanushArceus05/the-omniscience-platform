import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, OmniscienceClient } from "@omniscience/sdk";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { WorkspaceIndex } from "./WorkspaceIndex";

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

/** Renders with a real router so the `<Navigate>` redirect is observable. */
function renderIndex() {
  return render(
    <MemoryRouter initialEntries={["/app/workspace"]}>
      <AuthProvider>
        <Routes>
          <Route path="/app/workspace" element={<WorkspaceIndex />} />
          <Route path="/app/workspace/:workspaceId" element={<div>Detail for the redirected workspace</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("WorkspaceIndex", () => {
  it("redirects to the caller's most recent workspace when at least one exists", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi.fn().mockResolvedValue({
      workspaces: [{ id: "workspace_1", name: "Research", description: null, createdAt: "", updatedAt: "" }],
      nextCursor: null,
    });
    mockClient({ getMe, listWorkspaces });
    renderIndex();

    await waitFor(() => expect(screen.getByText("Detail for the redirected workspace")).toBeTruthy());
    expect(listWorkspaces).toHaveBeenCalledWith("access-token", { limit: 1 });
  });

  it("shows a real empty state, linking back to Overview, when the caller has no workspaces", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi.fn().mockResolvedValue({ workspaces: [], nextCursor: null });
    mockClient({ getMe, listWorkspaces });
    renderIndex();

    await waitFor(() => expect(screen.getByText("No workspaces yet")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Go to Overview" })).toBeTruthy();
  });

  it("shows a recoverable error state when the lookup fails, with a working retry", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError({ code: "NETWORK_ERROR", message: "network down", status: 0 }),
      )
      .mockResolvedValueOnce({ workspaces: [], nextCursor: null });
    mockClient({ getMe, listWorkspaces });
    renderIndex();

    await waitFor(() => expect(screen.getByText("Couldn't load your workspace")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("No workspaces yet")).toBeTruthy());
    expect(listWorkspaces).toHaveBeenCalledTimes(2);
  });
});
