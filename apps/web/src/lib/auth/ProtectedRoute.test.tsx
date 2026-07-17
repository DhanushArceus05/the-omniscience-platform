import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiClientError, OmniscienceClient } from "@omniscience/sdk";
import { ToastProvider } from "@omniscience/ui";
import { AuthProvider } from "./AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";
import { LoginPage } from "../../pages/LoginPage";

/**
 * Phase 3 Step 1 coverage: `AuthProvider`'s bootstrap state machine and
 * `ProtectedRoute`'s use of it. Mirrors the `AuthPages.test.tsx` pattern
 * of replacing the `OmniscienceClient` constructor with a mock so these
 * tests exercise the real bootstrap logic (getMe → refresh → retry)
 * against controlled responses instead of the network.
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
  return session;
}

function unauthorized(): ApiClientError {
  return new ApiClientError({ code: "UNAUTHORIZED", message: "A valid access token is required.", status: 401 });
}

const refreshedTokens = {
  accessToken: "new-access-token",
  accessTokenExpiresInSeconds: 900,
  refreshToken: "new-refresh-token",
  refreshTokenExpiresInSeconds: 604_800,
};

function renderApp(entry: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<div>Login screen</div>} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <div>Protected content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("ProtectedRoute + AuthContext bootstrap", () => {
  it("redirects a logged-out visit to /app to /login", async () => {
    mockClient({});
    renderApp("/app");
    await waitFor(() => expect(screen.getByText("Login screen")).toBeTruthy());
  });

  it("loads /app for a valid persisted session", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    mockClient({ getMe });
    renderApp("/app");

    await waitFor(() => expect(screen.getByText("Protected content")).toBeTruthy());
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(getMe).toHaveBeenCalledWith("access-token");
  });

  it("shows a loading state before bootstrap resolves and does not redirect prematurely", async () => {
    seedSession();
    let resolveGetMe!: (value: unknown) => void;
    const getMe = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGetMe = resolve;
        }),
    );
    mockClient({ getMe });
    renderApp("/app");

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("Login screen")).toBeNull();
    expect(screen.queryByText("Protected content")).toBeNull();

    resolveGetMe(USER);
    await waitFor(() => expect(screen.getByText("Protected content")).toBeTruthy());
  });

  it("silently recovers from an expired access token via a single refresh", async () => {
    seedSession();
    const getMe = vi.fn().mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce(USER);
    const refresh = vi.fn().mockResolvedValue(refreshedTokens);
    mockClient({ getMe, refresh });
    renderApp("/app");

    await waitFor(() => expect(screen.getByText("Protected content")).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ refreshToken: "refresh-token" });
    expect(getMe).toHaveBeenCalledTimes(2);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(stored.accessToken).toBe("new-access-token");
  });

  it("clears state and redirects to /login when the refresh token itself is invalid", async () => {
    seedSession();
    const getMe = vi.fn().mockRejectedValue(unauthorized());
    const refresh = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ code: "INVALID_REFRESH_TOKEN", message: "This session is no longer valid.", status: 401 }),
      );
    mockClient({ getMe, refresh });
    renderApp("/app");

    await waitFor(() => expect(screen.getByText("Login screen")).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("attempts refresh at most once per bootstrap flow, even if the retried /auth/me also fails", async () => {
    seedSession();
    const getMe = vi.fn().mockRejectedValue(unauthorized());
    const refresh = vi.fn().mockResolvedValue(refreshedTokens);
    mockClient({ getMe, refresh });
    renderApp("/app");

    await waitFor(() => expect(screen.getByText("Login screen")).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("returns to the originally-requested protected route after signing in", async () => {
    const login = vi.fn().mockResolvedValue({
      accessToken: "access-token",
      accessTokenExpiresInSeconds: 900,
      refreshToken: "refresh-token",
      refreshTokenExpiresInSeconds: 604_800,
      user: USER,
    });
    mockClient({ login });

    render(
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={["/app/workspace"]}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/app/workspace"
                element={
                  <ProtectedRoute>
                    <div>Workspace content</div>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2-Secret!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Workspace content")).toBeTruthy());
    expect(login).toHaveBeenCalledWith({ email: "person@example.com", password: "hunter2-Secret!" });
  });
});

/**
 * Regression coverage for the two infinite-loading reports from local
 * verification: "opening /app without logging in" and "refreshing after a
 * successful login" both got stuck on the loading spinner forever. Neither
 * reproduced without wrapping in the actual `<StrictMode>` `main.tsx` uses
 * (confirmed by first reproducing both here against the pre-fix code, then
 * confirming they resolved after the fix) — the `<AuthProvider>` used
 * elsewhere in this file without `<StrictMode>` never exhibited the bug.
 *
 * Root cause: the bootstrap effect used a `cancelled` flag scoped to a
 * single effect invocation's closure, set by that invocation's cleanup
 * function. React 18 StrictMode's dev-only mount→cleanup→remount cycle
 * fired that cleanup (setting `cancelled = true` permanently) immediately
 * after the first, real bootstrap call was kicked off but before it could
 * resolve — and the separate `bootstrapped` ref (correctly) prevented the
 * remount's effect invocation from starting a second bootstrap call. The
 * result: the one real result, when it arrived, was silently discarded by
 * the `if (cancelled) return` guard, and `authStatus` never left
 * `"loading"`. Fixed by replacing the per-invocation `cancelled` closure
 * with an `isMounted` ref that is reset to `true` at the start of every
 * effect invocation (including the StrictMode remount), so by the time the
 * first mount's in-flight promise resolves, the remount has already put it
 * back to `true`.
 */
describe("ProtectedRoute + AuthContext bootstrap — StrictMode regression", () => {
  function renderAppStrict(entry: string) {
    return render(
      <StrictMode>
        <AuthProvider>
          <MemoryRouter initialEntries={[entry]}>
            <Routes>
              <Route path="/login" element={<div>Login screen</div>} />
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <div>Protected content</div>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </StrictMode>,
    );
  }

  it("does not hang on the loading state under StrictMode when a valid session must be verified (reproduces 'refreshing after login' / 'opening in another browser with a session')", async () => {
    seedSession();
    const getMe = vi.fn().mockResolvedValue(USER);
    mockClient({ getMe });
    renderAppStrict("/app");

    await waitFor(() => expect(screen.getByText("Protected content")).toBeTruthy());
  });

  it("does not hang on the loading state under StrictMode when the persisted session is invalid and must be cleared (reproduces the same class of bug for a stale/expired session)", async () => {
    seedSession();
    const getMe = vi.fn().mockRejectedValue(unauthorized());
    const refresh = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ code: "INVALID_REFRESH_TOKEN", message: "This session is no longer valid.", status: 401 }),
      );
    mockClient({ getMe, refresh });
    renderAppStrict("/app");

    await waitFor(() => expect(screen.getByText("Login screen")).toBeTruthy());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("redirects immediately under StrictMode when there is no session at all (control case — confirms this path was never affected)", async () => {
    mockClient({});
    renderAppStrict("/app");

    await waitFor(() => expect(screen.getByText("Login screen")).toBeTruthy());
  });
});
