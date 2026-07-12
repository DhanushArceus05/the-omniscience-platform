import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@omniscience/ui";
import { App } from "./App";

vi.mock("@omniscience/sdk", () => ({
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
}));

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
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

  it("renders the OTP screen at /verify-otp", () => {
    renderAt("/verify-otp");
    expect(screen.getByRole("heading", { name: "Verify your email" })).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
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
