import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemStatusPanel } from "./SystemStatusPanel";

/**
 * Regression coverage for the runtime-config-missing crash: previously
 * `OmniscienceClient` was constructed at module scope directly from
 * `import.meta.env.VITE_API_BASE_URL` / `VITE_AI_SERVICE_BASE_URL`. When
 * those were unset (e.g. the frontend running standalone without the
 * API/AI service configured), the constructor threw during module
 * evaluation and crashed the whole app — including routes, like landing
 * and auth, that never use this panel. This suite renders the panel with
 * the real (unmocked) SDK client to prove that no longer happens.
 */
describe("SystemStatusPanel (missing runtime configuration)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders a configuration-unavailable state instead of throwing when both URLs are missing", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubEnv("VITE_AI_SERVICE_BASE_URL", "");

    expect(() => render(<SystemStatusPanel />)).not.toThrow();

    await waitFor(() => {
      expect(screen.getByText("API: configuration unavailable")).toBeTruthy();
      expect(screen.getByText("AI Service: configuration unavailable")).toBeTruthy();
    });
  });

  it(
    'renders "AI Service: Not Configured" (not an error) when only the AI service URL is ' +
      "missing, and never polls it — the API URL alone is enough to construct a working client",
    async () => {
      vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4000");
      vi.stubEnv("VITE_AI_SERVICE_BASE_URL", "");

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          service: "api",
          version: "0.1.0",
          timestamp: new Date().toISOString(),
          uptimeSeconds: 1,
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      expect(() => render(<SystemStatusPanel />)).not.toThrow();

      await waitFor(() => {
        expect(screen.getByText("API: ok")).toBeTruthy();
        expect(screen.getByText("AI Service: Not Configured")).toBeTruthy();
      });

      // Only the API health endpoint should ever be requested — no
      // request to an AI service URL should be made when it isn't
      // configured.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith("http://localhost:4000/health", { method: "GET" });
    },
  );
});
