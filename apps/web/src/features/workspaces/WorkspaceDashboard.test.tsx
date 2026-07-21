import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, OmniscienceClient } from "@omniscience/sdk";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { WorkspaceDashboard } from "./WorkspaceDashboard";

/**
 * Same pattern as `ProtectedRoute.test.tsx`/`AuthPages.test.tsx`: replace
 * the `OmniscienceClient` constructor with a mock so `WorkspaceDashboard`
 * exercises its real `listWorkspaces`/`createWorkspace` calls against a
 * controlled response instead of the network.
 */
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

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <AuthProvider>
        <Routes>
          <Route path="/app" element={<WorkspaceDashboard />} />
          <Route path="/app/workspace/:workspaceId" element={<div>Workspace detail page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const workspace = {
  id: "workspace_1",
  name: "Research",
  description: "Deep-dive projects",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("WorkspaceDashboard", () => {
  it("shows a loading state before the list resolves", async () => {
    seedSession();
    let resolveGetMe!: (value: unknown) => void;
    const getMe = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGetMe = resolve;
        }),
    );
    const listWorkspaces = vi.fn().mockResolvedValue({ workspaces: [], nextCursor: null });
    mockClient({ getMe, listWorkspaces });
    renderDashboard();

    expect(screen.getByLabelText("Loading your workspaces")).toBeTruthy();
    resolveGetMe(USER);

    await waitFor(() => expect(screen.getByText("No workspaces yet")).toBeTruthy());
  });

  it("shows a real empty state when the caller has no workspaces", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi.fn().mockResolvedValue({ workspaces: [], nextCursor: null });
    mockClient({ getMe, listWorkspaces });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("No workspaces yet")).toBeTruthy());
    expect(listWorkspaces).toHaveBeenCalledWith("access-token");
  });

  it("renders a populated workspace list newest-first, as returned by the API", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi.fn().mockResolvedValue({ workspaces: [workspace], nextCursor: null });
    mockClient({ getMe, listWorkspaces });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Research")).toBeTruthy());
    expect(screen.getByText("Deep-dive projects")).toBeTruthy();
    expect(screen.queryByText("No workspaces yet")).toBeNull();
  });

  it("shows a recoverable error state when the list request fails, with a working retry", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError({ code: "NETWORK_ERROR", message: "network down", status: 0 }),
      )
      .mockResolvedValueOnce({ workspaces: [workspace], nextCursor: null });
    mockClient({ getMe, listWorkspaces });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Couldn't load your workspaces")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("Research")).toBeTruthy());
    expect(listWorkspaces).toHaveBeenCalledTimes(2);
  });

  it("never leaves the page in an infinite loading state after a failure", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ code: "UNKNOWN_ERROR", message: "boom", status: 500 }),
      );
    mockClient({ getMe, listWorkspaces });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Couldn't load your workspaces")).toBeTruthy());
    expect(screen.queryByLabelText("Loading your workspaces")).toBeNull();
  });

  it("adds a newly created workspace to the visible list without a page refresh", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi.fn().mockResolvedValue({ workspaces: [], nextCursor: null });
    const createWorkspace = vi.fn().mockResolvedValue(workspace);
    mockClient({ getMe, listWorkspaces, createWorkspace });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("No workspaces yet")).toBeTruthy());

    fireEvent.click(screen.getAllByRole("button", { name: "Create workspace" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Research" } });
    fireEvent.change(within(dialog).getByLabelText("Description (optional)"), {
      target: { value: "Deep-dive projects" },
    });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Create workspace" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Research")).toBeTruthy());
    expect(createWorkspace).toHaveBeenCalledWith("access-token", {
      name: "Research",
      description: "Deep-dive projects",
    });
    // The modal's own submit button is gone once it closes; the header's
    // "Create workspace" trigger remains — but there is no full re-fetch.
    expect(listWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("shows a client-side validation error for an empty name and never calls the API", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi.fn().mockResolvedValue({ workspaces: [], nextCursor: null });
    const createWorkspace = vi.fn();
    mockClient({ getMe, listWorkspaces, createWorkspace });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("No workspaces yet")).toBeTruthy());

    fireEvent.click(screen.getAllByRole("button", { name: "Create workspace" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.submit(within(dialog).getByRole("button", { name: "Create workspace" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Workspace name is required")).toBeTruthy());
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("opens a workspace's detail route when its card is activated", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi.fn().mockResolvedValue({ workspaces: [workspace], nextCursor: null });
    mockClient({ getMe, listWorkspaces });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Research")).toBeTruthy());
    const card = screen.getByRole("link", { name: /Research/ });
    expect(card.getAttribute("href")).toBe("/app/workspace/workspace_1");

    fireEvent.click(card);
    await waitFor(() => expect(screen.getByText("Workspace detail page")).toBeTruthy());
  });

  it("shows a recoverable API error inside the modal when creation fails, keeping the modal open", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    const listWorkspaces = vi.fn().mockResolvedValue({ workspaces: [], nextCursor: null });
    const createWorkspace = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ code: "NETWORK_ERROR", message: "network down", status: 0 }),
      );
    mockClient({ getMe, listWorkspaces, createWorkspace });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("No workspaces yet")).toBeTruthy());

    fireEvent.click(screen.getAllByRole("button", { name: "Create workspace" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Research" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Create workspace" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Couldn't create workspace")).toBeTruthy());
    expect(within(dialog).getByLabelText("Name")).toBeTruthy();
  });
});
