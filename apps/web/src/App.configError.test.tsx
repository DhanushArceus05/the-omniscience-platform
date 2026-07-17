import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@omniscience/ui";
import { App } from "./App";

/**
 * Regression coverage: previously `SystemStatusPanel` built its
 * `OmniscienceClient` at module scope directly from
 * `import.meta.env.VITE_API_BASE_URL` / `VITE_AI_SERVICE_BASE_URL`, so a
 * missing value threw during module evaluation and crashed the whole
 * app before React ever rendered — including routes, like landing and
 * auth, that don't use the panel at all. This suite renders `<App />`
 * with the real (unmocked) SDK client and no configured URLs to prove
 * every route still renders instead of producing a blank page.
 */
function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("App routing without API/AI service configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    cleanup();
  });

  it("still renders the landing page when the API/AI service URLs are unset", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubEnv("VITE_AI_SERVICE_BASE_URL", "");

    expect(() => renderAt("/")).not.toThrow();
    expect(screen.getByText("The full spectrum of AI, orchestrated in one platform.")).toBeTruthy();
  });

  it("still renders the login screen when the API/AI service URLs are unset", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubEnv("VITE_AI_SERVICE_BASE_URL", "");

    expect(() => renderAt("/login")).not.toThrow();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  });

  it("redirects an unauthenticated visit to /app to /login without throwing, even when the URLs are unset", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubEnv("VITE_AI_SERVICE_BASE_URL", "");
    window.localStorage.clear();

    expect(() => renderAt("/app")).not.toThrow();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  });
});
