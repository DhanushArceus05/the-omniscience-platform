import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@omniscience/ui";
import { App } from "./App";

const USER = { id: "user-1", email: "person@example.com", name: "Person Name" };
const STORAGE_KEY = "omniscience.auth.session";

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

vi.mock("@omniscience/sdk", async () => {
  const actual = await vi.importActual<typeof import("@omniscience/sdk")>("@omniscience/sdk");
  return {
    ApiClientError: actual.ApiClientError,
    OmniscienceClient: vi.fn().mockImplementation(() => ({
      getApiHealth: vi.fn().mockResolvedValue({
        status: "ok",
        service: "api",
        version: "0.1.0",
        timestamp: new Date().toISOString(),
        uptimeSeconds: 1,
      }),
      getAiServiceHealth: vi.fn().mockResolvedValue({
        status: "ok",
        service: "ai-service",
        version: "0.1.0",
        timestamp: new Date().toISOString(),
        uptimeSeconds: 1,
      }),
      getMe: vi.fn().mockResolvedValue(USER),
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [{ id: "workspace_1", name: "Research", description: null, createdAt: "", updatedAt: "" }],
        nextCursor: null,
      }),
      getWorkspace: vi.fn().mockResolvedValue({
        id: "workspace_1",
        name: "Research",
        description: "Deep-dive projects",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    })),
  };
});

function renderAt(entry: string | { pathname: string; state?: unknown }) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[entry]}>
        <App />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
});

describe("App routing", () => {
  it("renders the landing page at /", () => {
    renderAt("/");
    expect(screen.getByText("The full spectrum of AI, orchestrated in one platform.")).toBeTruthy();
  });

  it("renders the login screen at /login", () => {
    renderAt("/login");
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  });

  it("renders the register screen at /register", () => {
    renderAt("/register");
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy();
  });

  it("renders the OTP screen at /verify-otp when navigated with an email", () => {
    renderAt({ pathname: "/verify-otp", state: { email: "person@example.com" } });
    expect(screen.getByRole("heading", { name: "Verify your email" })).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
  });

  it("renders a fallback at /verify-otp when no email was passed via navigation", () => {
    renderAt("/verify-otp");
    expect(screen.getByRole("heading", { name: "Verify your email" })).toBeTruthy();
    expect(screen.getByText(/couldn't find a registration in progress/i)).toBeTruthy();
  });

  it("renders the forgot-password screen", () => {
    renderAt("/forgot-password");
    expect(screen.getByRole("heading", { name: "Forgot your password?" })).toBeTruthy();
  });

  it("renders the reset-password screen", () => {
    renderAt("/reset-password");
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeTruthy();
  });

  it("redirects an unauthenticated visit to /app to /login", () => {
    window.localStorage.clear();
    renderAt("/app");
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  });

  it("renders the not-found page for an unknown route", () => {
    renderAt("/does-not-exist");
    expect(screen.getByText("Page not found")).toBeTruthy();
  });

  it("redirects an unauthenticated visit to /app/workspace to /login", () => {
    renderAt("/app/workspace");
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  });

  it("no longer 404s at /app/workspace for a signed-in caller — it forwards to their workspace", async () => {
    seedSession();
    renderAt("/app/workspace");
    await screen.findByText("Research");
    expect(screen.queryByText("Page not found")).toBeNull();
  });

  it("renders the real workspace detail page at /app/workspace/:workspaceId", async () => {
    seedSession();
    renderAt("/app/workspace/workspace_1");
    expect(await screen.findByRole("heading", { name: "Research" })).toBeTruthy();
    expect(screen.getByText("Deep-dive projects")).toBeTruthy();
    expect(screen.queryByText("Page not found")).toBeNull();
  });
});
