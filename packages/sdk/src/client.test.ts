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

  it("does not throw when aiServiceBaseUrl is omitted (AI service not configured for this phase)", () => {
    expect(() => new OmniscienceClient({ apiBaseUrl: "http://x" })).not.toThrow();
  });

  it("reports isAiServiceConfigured() as false when aiServiceBaseUrl is omitted or empty", () => {
    expect(new OmniscienceClient({ apiBaseUrl: "http://x" }).isAiServiceConfigured()).toBe(false);
    expect(
      new OmniscienceClient({ apiBaseUrl: "http://x", aiServiceBaseUrl: "" }).isAiServiceConfigured(),
    ).toBe(false);
  });

  it("reports isAiServiceConfigured() as true when aiServiceBaseUrl is provided", () => {
    expect(
      new OmniscienceClient({
        apiBaseUrl: "http://x",
        aiServiceBaseUrl: "http://localhost:8000",
      }).isAiServiceConfigured(),
    ).toBe(true);
  });

  it("getAiServiceHealth() throws a descriptive error when aiServiceBaseUrl is not configured", async () => {
    const client = new OmniscienceClient({ apiBaseUrl: "http://x" });
    await expect(client.getAiServiceHealth()).rejects.toThrow(/not configured/);
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

  it("refresh() posts to /auth/refresh and unwraps ApiSuccess.data", async () => {
    const data = {
      accessToken: "new-access",
      accessTokenExpiresInSeconds: 900,
      refreshToken: "new-refresh",
      refreshTokenExpiresInSeconds: 604_800,
    };
    const fetchImpl = mockJsonFetch(200, { success: true, data });
    const client = makeClient(fetchImpl);

    const result = await client.refresh({ refreshToken: "old-refresh" });

    expect(result).toEqual(data);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/auth/refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ refreshToken: "old-refresh" }),
      }),
    );
  });

  it("throws ApiClientError when refresh() is called with an invalid refresh token", async () => {
    const fetchImpl = mockJsonFetch(401, {
      success: false,
      error: { code: "INVALID_REFRESH_TOKEN", message: "This session is no longer valid." },
    });
    const client = makeClient(fetchImpl);

    await expect(client.refresh({ refreshToken: "stale" })).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
      status: 401,
    });
  });

  it("getMe() sends the access token as a Bearer header and unwraps ApiSuccess.data", async () => {
    const data = { id: "user-1", email: "person@example.com", name: "Person Name" };
    const fetchImpl = mockJsonFetch(200, { success: true, data });
    const client = makeClient(fetchImpl);

    const result = await client.getMe("access-token");

    expect(result).toEqual(data);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/auth/me",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer access-token" },
      }),
    );
  });

  it("throws ApiClientError with status 401 when getMe() is called with an expired access token", async () => {
    const fetchImpl = mockJsonFetch(401, {
      success: false,
      error: { code: "UNAUTHORIZED", message: "A valid access token is required." },
    });
    const client = makeClient(fetchImpl);

    await expect(client.getMe("expired")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });
});

describe("OmniscienceClient workspace methods (Phase 3 Step 2)", () => {
  const workspace = {
    id: "workspace_1",
    name: "Research",
    description: "Deep-dive projects",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("createWorkspace() posts to /workspaces with a Bearer header and unwraps ApiSuccess.data", async () => {
    const fetchImpl = mockJsonFetch(201, { success: true, data: workspace });
    const client = makeClient(fetchImpl);

    const result = await client.createWorkspace("access-token", {
      name: "Research",
      description: "Deep-dive projects",
    });

    expect(result).toEqual(workspace);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/workspaces",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer access-token" },
        body: JSON.stringify({ name: "Research", description: "Deep-dive projects" }),
      }),
    );
  });

  it("createWorkspace() surfaces a structured ApiClientError on validation failure", async () => {
    const fetchImpl = mockJsonFetch(400, {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ path: "name", message: "Workspace name is required" }],
      },
    });
    const client = makeClient(fetchImpl);

    await expect(client.createWorkspace("access-token", { name: "" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
      details: [{ path: "name", message: "Workspace name is required" }],
    });
  });

  it("listWorkspaces() sends a Bearer header and no query string when called with no arguments", async () => {
    const fetchImpl = mockJsonFetch(200, {
      success: true,
      data: { workspaces: [workspace], nextCursor: null },
    });
    const client = makeClient(fetchImpl);

    const result = await client.listWorkspaces("access-token");

    expect(result).toEqual({ workspaces: [workspace], nextCursor: null });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/workspaces",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer access-token" },
      }),
    );
  });

  it("listWorkspaces() encodes limit and cursor as query params", async () => {
    const fetchImpl = mockJsonFetch(200, {
      success: true,
      data: { workspaces: [], nextCursor: "opaque-cursor" },
    });
    const client = makeClient(fetchImpl);

    await client.listWorkspaces("access-token", { limit: 10, cursor: "prev-cursor" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/workspaces?limit=10&cursor=prev-cursor",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("listWorkspaces() does not retry or refresh on a 401 — it surfaces ApiClientError as-is", async () => {
    const fetchImpl = mockJsonFetch(401, {
      success: false,
      error: { code: "UNAUTHORIZED", message: "A valid access token is required." },
    });
    const client = makeClient(fetchImpl);

    await expect(client.listWorkspaces("expired")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("getWorkspace() sends a Bearer header and URL-encodes the id", async () => {
    const fetchImpl = mockJsonFetch(200, { success: true, data: workspace });
    const client = makeClient(fetchImpl);

    const result = await client.getWorkspace("access-token", "workspace 1/special");

    expect(result).toEqual(workspace);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/workspaces/workspace%201%2Fspecial",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer access-token" },
      }),
    );
  });

  it("getWorkspace() surfaces WORKSPACE_NOT_FOUND identically for a missing or foreign id", async () => {
    const fetchImpl = mockJsonFetch(404, {
      success: false,
      error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found." },
    });
    const client = makeClient(fetchImpl);

    await expect(client.getWorkspace("access-token", "anything")).rejects.toMatchObject({
      code: "WORKSPACE_NOT_FOUND",
      status: 404,
    });
  });
});

describe("OmniscienceClient account/session/avatar methods (Phase 3 Step 3)", () => {
  it("updateProfile() patches /users/me with a Bearer header and unwraps ApiSuccess.data", async () => {
    const data = { id: "user_1", email: "user@example.com", name: "New Name", avatarUrl: null };
    const fetchImpl = mockJsonFetch(200, { success: true, data });
    const client = makeClient(fetchImpl);

    const result = await client.updateProfile("access-token", { name: "New Name" });

    expect(result).toEqual(data);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/users/me",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer access-token" },
        body: JSON.stringify({ name: "New Name" }),
      }),
    );
  });

  it("uploadAvatar() posts a FormData body to /users/me/avatar without setting Content-Type manually", async () => {
    const data = { avatarUrl: "http://localhost:4000/uploads/avatars/abc.jpg" };
    const fetchImpl = mockJsonFetch(200, { success: true, data });
    const client = makeClient(fetchImpl);
    const file = new Blob(["fake-image-bytes"], { type: "image/jpeg" });

    const result = await client.uploadAvatar("access-token", file);

    expect(result).toEqual(data);
    const mockCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const [url, init] = mockCalls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/users/me/avatar");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer access-token" });
    expect(init.body).toBeInstanceOf(FormData);
    const submittedFile = (init.body as FormData).get("file") as Blob;
    expect(submittedFile.size).toBe(file.size);
    expect(submittedFile.type).toBe(file.type);
  });

  it("uploadAvatar() surfaces a structured ApiClientError for an unsupported type", async () => {
    const fetchImpl = mockJsonFetch(415, {
      success: false,
      error: { code: "AVATAR_TYPE_UNSUPPORTED", message: "Avatar must be a JPEG, PNG, or WebP image." },
    });
    const client = makeClient(fetchImpl);
    const file = new Blob(["not-an-image"], { type: "image/gif" });

    await expect(client.uploadAvatar("access-token", file)).rejects.toMatchObject({
      code: "AVATAR_TYPE_UNSUPPORTED",
      status: 415,
    });
  });

  it("uploadAvatar() surfaces a structured ApiClientError for an oversized file", async () => {
    const fetchImpl = mockJsonFetch(413, {
      success: false,
      error: { code: "AVATAR_TOO_LARGE", message: "The uploaded file is too large." },
    });
    const client = makeClient(fetchImpl);
    const file = new Blob(["x"], { type: "image/jpeg" });

    await expect(client.uploadAvatar("access-token", file)).rejects.toMatchObject({
      code: "AVATAR_TOO_LARGE",
      status: 413,
    });
  });

  it("deleteAvatar() sends a Bearer header and unwraps a null avatarUrl", async () => {
    const fetchImpl = mockJsonFetch(200, { success: true, data: { avatarUrl: null } });
    const client = makeClient(fetchImpl);

    const result = await client.deleteAvatar("access-token");

    expect(result).toEqual({ avatarUrl: null });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/users/me/avatar",
      expect.objectContaining({ method: "DELETE", headers: { Authorization: "Bearer access-token" } }),
    );
  });

  it("changePassword() posts to /users/me/change-password", async () => {
    const fetchImpl = mockJsonFetch(200, {
      success: true,
      data: { email: "user@example.com" },
    });
    const client = makeClient(fetchImpl);

    const result = await client.changePassword("access-token", {
      currentPassword: "OldPassw0rd!",
      newPassword: "N3wSup3r$ecretPassw0rd!",
    });

    expect(result).toEqual({ email: "user@example.com" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/users/me/change-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          currentPassword: "OldPassw0rd!",
          newPassword: "N3wSup3r$ecretPassw0rd!",
        }),
      }),
    );
  });

  it("changePassword() surfaces CURRENT_PASSWORD_INCORRECT as a structured ApiClientError", async () => {
    const fetchImpl = mockJsonFetch(400, {
      success: false,
      error: { code: "CURRENT_PASSWORD_INCORRECT", message: "The current password is incorrect." },
    });
    const client = makeClient(fetchImpl);

    await expect(
      client.changePassword("access-token", {
        currentPassword: "wrong",
        newPassword: "N3wSup3r$ecretPassw0rd!",
      }),
    ).rejects.toMatchObject({ code: "CURRENT_PASSWORD_INCORRECT", status: 400 });
  });

  it("deleteAccount() sends a DELETE with a JSON body to /users/me", async () => {
    const fetchImpl = mockJsonFetch(200, { success: true, data: { deleted: true } });
    const client = makeClient(fetchImpl);

    const result = await client.deleteAccount("access-token", { password: "CorrectPassw0rd!" });

    expect(result).toEqual({ deleted: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/users/me",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ password: "CorrectPassw0rd!" }),
      }),
    );
  });

  it("listSessions() sends a Bearer header and returns the session array", async () => {
    const sessions = [{ tokenId: "token_1", createdAt: "2026-01-01T00:00:00.000Z" }];
    const fetchImpl = mockJsonFetch(200, { success: true, data: sessions });
    const client = makeClient(fetchImpl);

    const result = await client.listSessions("access-token");

    expect(result).toEqual(sessions);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/auth/sessions",
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer access-token" } }),
    );
  });

  it("revokeSession() URL-encodes the tokenId and sends DELETE", async () => {
    const fetchImpl = mockJsonFetch(200, { success: true, data: { revoked: true } });
    const client = makeClient(fetchImpl);

    const result = await client.revokeSession("access-token", "token/with-slash");

    expect(result).toEqual({ revoked: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/auth/sessions/token%2Fwith-slash",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("revokeSession() surfaces SESSION_NOT_FOUND identically for a missing or foreign tokenId", async () => {
    const fetchImpl = mockJsonFetch(404, {
      success: false,
      error: { code: "SESSION_NOT_FOUND", message: "Session not found." },
    });
    const client = makeClient(fetchImpl);

    await expect(client.revokeSession("access-token", "anything")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      status: 404,
    });
  });

  it("revokeAllSessions() posts to /auth/sessions/revoke-all and returns the revoked count", async () => {
    const fetchImpl = mockJsonFetch(200, { success: true, data: { revokedCount: 3 } });
    const client = makeClient(fetchImpl);

    const result = await client.revokeAllSessions("access-token");

    expect(result).toEqual({ revokedCount: 3 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/auth/sessions/revoke-all",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer access-token" } }),
    );
  });
});
