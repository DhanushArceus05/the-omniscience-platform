import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, OmniscienceClient } from "@omniscience/sdk";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { WorkspaceDetail } from "./WorkspaceDetail";

/** Same mocking convention as `WorkspaceDashboard.test.tsx`. */
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

function renderDetail(workspaceId = "workspace_1") {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <WorkspaceDetail workspaceId={workspaceId} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const workspace = {
  id: "workspace_1",
  name: "Research",
  description: "Deep-dive projects",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("WorkspaceDetail", () => {
  it("shows an accessible loading state before the workspace resolves", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    let resolveGetWorkspace!: (value: unknown) => void;
    const getWorkspace = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGetWorkspace = resolve;
        }),
    );
    mockClient({ getMe, getWorkspace });
    renderDetail();

    expect(screen.getByLabelText("Loading workspace")).toBeTruthy();
    resolveGetWorkspace(workspace);

    await waitFor(() => expect(screen.getByText("Research")).toBeTruthy());
  });

  it("renders the workspace name, description, owner, created date, and metadata once loaded", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const getWorkspace = vi.fn().mockResolvedValue(workspace);
    mockClient({ getMe, getWorkspace });
    renderDetail("workspace_1");

    await waitFor(() => expect(screen.getByText("Research")).toBeTruthy());
    expect(screen.getByText("Deep-dive projects")).toBeTruthy();
    expect(screen.getByText("Person Name")).toBeTruthy();
    expect(screen.getByText("workspace_1")).toBeTruthy();
    expect(getWorkspace).toHaveBeenCalledWith("access-token", "workspace_1");

    // The seven module placeholders are all present and clearly non-final.
    for (const title of [
      "AI Assistant",
      "Documents",
      "Knowledge Base",
      "Agents",
      "Files",
      "Tasks",
      "Activity",
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getAllByText("Coming soon")).toHaveLength(7);
  });

  it("shows a dedicated not-found state for a missing or foreign workspace id, with a way back", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const getWorkspace = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ code: "WORKSPACE_NOT_FOUND", message: "Workspace not found.", status: 404 }),
      );
    mockClient({ getMe, getWorkspace });
    renderDetail("does-not-exist");

    await waitFor(() => expect(screen.getByText("Workspace not found")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Back to Overview" })).toBeTruthy();
  });

  it("shows a recoverable error state for any other failure, with a working retry", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const getWorkspace = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError({ code: "NETWORK_ERROR", message: "network down", status: 0 }),
      )
      .mockResolvedValueOnce(workspace);
    mockClient({ getMe, getWorkspace });
    renderDetail("workspace_1");

    await waitFor(() => expect(screen.getByText("Couldn't load this workspace")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("Research")).toBeTruthy());
    expect(getWorkspace).toHaveBeenCalledTimes(2);
  });
});
