import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getApiHealth = vi.fn();
const getAiServiceHealth = vi.fn();
const isAiServiceConfigured = vi.fn();

vi.mock("@omniscience/sdk", () => ({
  OmniscienceClient: vi.fn().mockImplementation(() => ({
    getApiHealth,
    getAiServiceHealth,
    isAiServiceConfigured,
  })),
}));

async function renderPanel() {
  const { SystemStatusPanel } = await import("./SystemStatusPanel");
  render(<SystemStatusPanel />);
}

describe("SystemStatusPanel", () => {
  afterEach(() => {
    vi.resetModules();
    getApiHealth.mockReset();
    getAiServiceHealth.mockReset();
    isAiServiceConfigured.mockReset();
  });

  it("shows ok status badges once both health checks succeed", async () => {
    isAiServiceConfigured.mockReturnValue(true);
    getApiHealth.mockResolvedValue({
      status: "ok",
      service: "api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: 1,
    });
    getAiServiceHealth.mockResolvedValue({
      status: "ok",
      service: "ai-service",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: 1,
    });

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByText("API: ok")).toBeTruthy();
      expect(screen.getByText("AI Service: ok")).toBeTruthy();
    });
  });

  it("shows an unreachable badge when a health check fails", async () => {
    isAiServiceConfigured.mockReturnValue(true);
    getApiHealth.mockRejectedValue(new Error("network error"));
    getAiServiceHealth.mockResolvedValue({
      status: "ok",
      service: "ai-service",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: 1,
    });

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByText("API: unreachable")).toBeTruthy();
    });
  });

  /**
   * Regression coverage for the localhost:8000 ERR_CONNECTION_REFUSED bug:
   * when no AI service URL is configured, the panel must show a neutral
   * "Not Configured" badge and must NEVER call getAiServiceHealth() —
   * that call is exactly what produced the repeated connection-refused
   * errors when polling a service that isn't running in this phase.
   */
  it('shows "AI Service: Not Configured" and never polls the AI service when it is not configured', async () => {
    isAiServiceConfigured.mockReturnValue(false);
    getApiHealth.mockResolvedValue({
      status: "ok",
      service: "api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: 1,
    });

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByText("API: ok")).toBeTruthy();
      expect(screen.getByText("AI Service: Not Configured")).toBeTruthy();
    });

    expect(getAiServiceHealth).not.toHaveBeenCalled();
  });
});
