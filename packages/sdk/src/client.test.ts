import { describe, expect, it, vi } from "vitest";
import { OmniscienceClient } from "./client";
import { ApiClientError } from "./api-client-error";

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

function mockJsonFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

function makeClient(fetchImpl: typeof fetch) {
  return new OmniscienceClient({
    apiBaseUrl: "http://localhost:4000",
    aiServiceBaseUrl: "http://localhost:8000",
    fetchImpl,
  });
}

describe("OmniscienceClient auth methods", () => {
  it("register() posts to /auth/register and unwraps ApiSuccess.data", async () => {
    const data = { email: "person@example.com", otpExpiresInSeconds: 600 };
    const fetchImpl = mockJsonFetch(202, { success: true, data });
    const client = makeClient(fetchImpl);

    const result = await client.register({
      email: "person@example.com",
      password: "Sup3r!Secret",
      name: "Person",
    });

    expect(result).toEqual(data);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/auth/register",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("login() posts to /auth/login and unwraps ApiSuccess.data", async () => {
    const data = {
      accessToken: "access",
      accessTokenExpiresInSeconds: 900,
      refreshToken: "refresh",
      refreshTokenExpiresInSeconds: 604_800,
      user: { id: "1", email: "person@example.com", name: "Person" },
    };
    const fetchImpl = mockJsonFetch(200, { success: true, data });
    const client = makeClient(fetchImpl);

    const result = await client.login({ email: "person@example.com", password: "Sup3r!Secret" });

    expect(result).toEqual(data);
  });

  it("throws ApiClientError with the backend's code/message/details on a structured error", async () => {
    const fetchImpl = mockJsonFetch(409, {
      success: false,
      error: { code: "EMAIL_ALREADY_REGISTERED", message: "An account with this email already exists." },
    });
    const client = makeClient(fetchImpl);

    await expect(
      client.register({ email: "taken@example.com", password: "Sup3r!Secret", name: "Person" }),
    ).rejects.toMatchObject(
      new ApiClientError({
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account with this email already exists.",
        status: 409,
      }),
    );
  });

  it("throws ApiClientError with VALIDATION_ERROR details for a 400", async () => {
    const fetchImpl = mockJsonFetch(400, {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ path: "email", message: "Enter a valid email address" }],
      },
    });
    const client = makeClient(fetchImpl);

    await expect(
      client.login({ email: "not-an-email", password: "x" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ path: "email", message: "Enter a valid email address" }],
    });
  });

  it("throws ApiClientError when the network request itself fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);

    await expect(
      client.forgotPassword({ email: "person@example.com" }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});
