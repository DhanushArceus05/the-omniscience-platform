import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@omniscience/ui";
import { App } from "./App";

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

  it("renders the app shell preview at /app", () => {
    renderAt("/app");
    expect(screen.getByText("Dashboard arrives in Phase 3")).toBeTruthy();
  });

  it("renders the not-found page for an unknown route", () => {
    renderAt("/does-not-exist");
    expect(screen.getByText("Page not found")).toBeTruthy();
  });
});
