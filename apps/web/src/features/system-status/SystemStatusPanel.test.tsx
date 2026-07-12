import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getApiHealth = vi.fn();
const getAiServiceHealth = vi.fn();

vi.mock("@omniscience/sdk", () => ({
  OmniscienceClient: vi.fn().mockImplementation(() => ({
    getApiHealth,
    getAiServiceHealth,
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
  });

  it("shows ok status badges once both health checks succeed", async () => {
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
});
