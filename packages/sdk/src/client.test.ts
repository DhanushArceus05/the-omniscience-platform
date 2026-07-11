import { describe, expect, it, vi } from "vitest";
import { OmniscienceClient } from "./client";

const healthPayload = {
  status: "ok" as const,
  service: "api",
  version: "0.1.0",
  timestamp: new Date().toISOString(),
  uptimeSeconds: 1,
};

function mockFetch(ok: boolean, body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("OmniscienceClient", () => {
  it("throws if apiBaseUrl is missing", () => {
    expect(() => new OmniscienceClient({ apiBaseUrl: "", aiServiceBaseUrl: "http://x" })).toThrow(
      /apiBaseUrl/,
    );
  });

  it("throws if aiServiceBaseUrl is missing", () => {
    expect(() => new OmniscienceClient({ apiBaseUrl: "http://x", aiServiceBaseUrl: "" })).toThrow(
      /aiServiceBaseUrl/,
    );
  });

  it("fetches API health successfully", async () => {
    const fetchImpl = mockFetch(true, healthPayload);
    const client = new OmniscienceClient({
      apiBaseUrl: "http://localhost:4000",
      aiServiceBaseUrl: "http://localhost:8000",
      fetchImpl,
    });
    const result = await client.getApiHealth();
    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:4000/health", { method: "GET" });
  });

  it("throws a descriptive error on a non-ok response", async () => {
    const fetchImpl = mockFetch(false, {}, 503);
    const client = new OmniscienceClient({
      apiBaseUrl: "http://localhost:4000",
      aiServiceBaseUrl: "http://localhost:8000",
      fetchImpl,
    });
    await expect(client.getAiServiceHealth()).rejects.toThrow(/503/);
  });
});
