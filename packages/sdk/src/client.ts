import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  DeleteAccountRequest,
  DeleteAccountResponse,
  DeleteAvatarResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  GetWorkspaceResponse,
  HealthCheckResponse,
  ListSessionsResponse,
  ListWorkspacesQuery,
  ListWorkspacesResponse,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  LogoutResponse,
  MeResponse,
  RefreshRequest,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  ResendOtpRequest,
  ResendOtpResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  RevokeAllSessionsResponse,
  RevokeSessionResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
  UploadAvatarResponse,
  VerifyOtpRequest,
  VerifyOtpResponse,
} from "@omniscience/types";
import { ApiClientError } from "./api-client-error";

export interface OmniscienceClientOptions {
  apiBaseUrl: string;
  /**
   * Optional. The AI service (`apps/ai-service`) is not part of every
   * phase — leave this unset when no AI service is configured. Callers
   * must check `isAiServiceConfigured()` (or catch the descriptive error
   * from `getAiServiceHealth()`) before assuming it's reachable.
   */
  aiServiceBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin typed client over the platform's HTTP services.
 * Phase 0 intentionally exposed only health checks; Phase 2 (Steps 3–5)
 * adds the registration/OTP/login/password-reset methods below, each a
 * direct mirror of the corresponding `apps/api` `AuthController` route
 * and the shared `@omniscience/types` request/response contracts — no
 * contract is redefined here, only called.
 */
export class OmniscienceClient {
  private readonly apiBaseUrl: string;
  private readonly aiServiceBaseUrl: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OmniscienceClientOptions) {
    if (!options.apiBaseUrl) {
      throw new Error("OmniscienceClient requires apiBaseUrl");
    }
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.aiServiceBaseUrl = options.aiServiceBaseUrl
      ? options.aiServiceBaseUrl.replace(/\/$/, "")
      : null;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Whether an AI service base URL was provided. Callers (e.g.
   * `SystemStatusPanel`) must check this before polling
   * `getAiServiceHealth()` — the AI service isn't part of every phase,
   * and polling an unconfigured URL only produces connection-refused
   * noise for a service that was never meant to run.
   */
  isAiServiceConfigured(): boolean {
    return this.aiServiceBaseUrl !== null;
  }

  async getApiHealth(): Promise<HealthCheckResponse> {
    return this.getJson<HealthCheckResponse>(`${this.apiBaseUrl}/health`);
  }

  async getAiServiceHealth(): Promise<HealthCheckResponse> {
    if (!this.aiServiceBaseUrl) {
      throw new Error(
        "OmniscienceClient: aiServiceBaseUrl is not configured; call isAiServiceConfigured() first",
      );
    }
    return this.getJson<HealthCheckResponse>(`${this.aiServiceBaseUrl}/health`);
  }

  /** `POST /auth/register` — Phase 2 Step 3. */
  async register(input: RegisterRequest): Promise<RegisterResponse> {
    return this.postJson<RegisterRequest, RegisterResponse>("/auth/register", input);
  }

  /** `POST /auth/verify-otp` — Phase 2 Step 3. */
  async verifyOtp(input: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    return this.postJson<VerifyOtpRequest, VerifyOtpResponse>("/auth/verify-otp", input);
  }

  /** `POST /auth/resend-otp` — Phase 2 Step 3. */
  async resendOtp(input: ResendOtpRequest): Promise<ResendOtpResponse> {
    return this.postJson<ResendOtpRequest, ResendOtpResponse>("/auth/resend-otp", input);
  }

  /** `POST /auth/login` — Phase 2 Step 4. */
  async login(input: LoginRequest): Promise<LoginResponse> {
    return this.postJson<LoginRequest, LoginResponse>("/auth/login", input);
  }

  /** `POST /auth/logout` — Phase 2 Step 4. */
  async logout(input: LogoutRequest): Promise<LogoutResponse> {
    return this.postJson<LogoutRequest, LogoutResponse>("/auth/logout", input);
  }

  /**
   * `POST /auth/refresh` — Phase 2 Step 4. Rotates the refresh token: the
   * request's token is single-use, and both a new access token and a new
   * refresh token come back. Callers must persist the returned tokens and
   * discard the ones they sent.
   */
  async refresh(input: RefreshRequest): Promise<RefreshResponse> {
    return this.postJson<RefreshRequest, RefreshResponse>("/auth/refresh", input);
  }

  /**
   * `GET /auth/me` — Phase 2 Step 4 / Phase 3 Step 1. Confirms an access
   * token is still valid and returns the identity the backend associates
   * with it — the frontend never decodes the JWT itself to make that
   * determination, only ever asks the backend via this call.
   */
  async getMe(accessToken: string): Promise<MeResponse> {
    return this.request<MeResponse>(`${this.apiBaseUrl}/auth/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  /** `POST /auth/forgot-password` — Phase 2 Step 5. */
  async forgotPassword(input: ForgotPasswordRequest): Promise<ForgotPasswordResponse> {
    return this.postJson<ForgotPasswordRequest, ForgotPasswordResponse>(
      "/auth/forgot-password",
      input,
    );
  }

  /** `POST /auth/reset-password` — Phase 2 Step 5. */
  async resetPassword(input: ResetPasswordRequest): Promise<ResetPasswordResponse> {
    return this.postJson<ResetPasswordRequest, ResetPasswordResponse>(
      "/auth/reset-password",
      input,
    );
  }

  /**
   * `POST /workspaces` — Phase 3 Step 2. Creates a workspace owned by
   * whichever identity `accessToken` belongs to — ownership is decided
   * entirely server-side from the verified JWT, never from `input`.
   */
  async createWorkspace(
    accessToken: string,
    input: CreateWorkspaceRequest,
  ): Promise<CreateWorkspaceResponse> {
    return this.request<CreateWorkspaceResponse>(`${this.apiBaseUrl}/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input),
    });
  }

  /**
   * `GET /workspaces` — Phase 3 Step 2. Bounded, keyset-paginated list
   * of the caller's own workspaces, newest first. `query.limit` is
   * capped server-side (`MAX_WORKSPACE_LIST_LIMIT`); `query.cursor`
   * should be the previous call's `nextCursor` verbatim, or omitted for
   * the first page.
   *
   * No automatic 401-refresh-and-retry here by design — this is the
   * same "caller decides what to do on failure" contract every other
   * method on this client already has. In-page token refresh remains a
   * documented future step, not something bolted onto individual
   * methods ad hoc.
   */
  async listWorkspaces(
    accessToken: string,
    query?: ListWorkspacesQuery,
  ): Promise<ListWorkspacesResponse> {
    const params = new URLSearchParams();
    if (query?.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    if (query?.cursor) {
      params.set("cursor", query.cursor);
    }
    const queryString = params.toString();
    return this.request<ListWorkspacesResponse>(
      `${this.apiBaseUrl}/workspaces${queryString ? `?${queryString}` : ""}`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }

  /**
   * `GET /workspaces/:id` — Phase 3 Step 2. Throws `ApiClientError` with
   * `code: "WORKSPACE_NOT_FOUND"` (404) both when the id doesn't exist
   * at all and when it belongs to a different owner — identical either
   * way, by design, on the backend.
   */
  async getWorkspace(accessToken: string, id: string): Promise<GetWorkspaceResponse> {
    return this.request<GetWorkspaceResponse>(
      `${this.apiBaseUrl}/workspaces/${encodeURIComponent(id)}`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }

  /** `PATCH /users/me` — Phase 2 Step 6. Updates the caller's own display name. */
  async updateProfile(
    accessToken: string,
    input: UpdateProfileRequest,
  ): Promise<UpdateProfileResponse> {
    return this.request<UpdateProfileResponse>(`${this.apiBaseUrl}/users/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input),
    });
  }

  /**
   * `POST /users/me/avatar` — Phase 3 Step 3. Uploads (or replaces) the
   * caller's own avatar as `multipart/form-data`. Deliberately takes a
   * platform-native `Blob`/`File` rather than a raw `Buffer` — this
   * runs in the browser, where `FormData`/`File`/`Blob` are the native
   * types, and building a `FormData` body is the only thing this
   * method does differently from every other method here: no
   * `Content-Type` header is set explicitly, since `fetch` sets the
   * correct `multipart/form-data; boundary=...` value itself only when
   * the body is a real `FormData` instance — setting it manually would
   * omit the boundary and break the upload.
   */
  async uploadAvatar(accessToken: string, file: Blob): Promise<UploadAvatarResponse> {
    const formData = new FormData();
    formData.append("file", file);
    return this.request<UploadAvatarResponse>(`${this.apiBaseUrl}/users/me/avatar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  }

  /** `DELETE /users/me/avatar` — Phase 3 Step 3. Removes the caller's own avatar, if any. Always succeeds. */
  async deleteAvatar(accessToken: string): Promise<DeleteAvatarResponse> {
    return this.request<DeleteAvatarResponse>(`${this.apiBaseUrl}/users/me/avatar`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  /** `POST /users/me/change-password` — Phase 2 Step 6. Requires the caller's current password. */
  async changePassword(
    accessToken: string,
    input: ChangePasswordRequest,
  ): Promise<ChangePasswordResponse> {
    return this.request<ChangePasswordResponse>(`${this.apiBaseUrl}/users/me/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input),
    });
  }

  /**
   * `DELETE /users/me` — Phase 2 Step 8. Permanently deletes the
   * caller's own account. Irreversible — there is no undo. Requires
   * the caller's current password (`input.password`); any additional
   * "type DELETE MY ACCOUNT to confirm" safeguard is a UI-only
   * affordance layered on top of this call, not part of the request
   * contract itself.
   */
  async deleteAccount(
    accessToken: string,
    input: DeleteAccountRequest,
  ): Promise<DeleteAccountResponse> {
    return this.request<DeleteAccountResponse>(`${this.apiBaseUrl}/users/me`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input),
    });
  }

  /** `GET /auth/sessions` — Phase 2 Step 7. Lists the caller's own active sessions, newest first. */
  async listSessions(accessToken: string): Promise<ListSessionsResponse> {
    return this.request<ListSessionsResponse>(`${this.apiBaseUrl}/auth/sessions`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  /**
   * `DELETE /auth/sessions/:tokenId` — Phase 2 Step 7. Revokes exactly
   * one of the caller's own sessions. Throws `ApiClientError` with
   * `code: "SESSION_NOT_FOUND"` (404) both when `tokenId` doesn't exist
   * at all and when it belongs to a different caller — identical
   * either way, by design, on the backend (same no-enumeration
   * convention `getWorkspace`'s `WORKSPACE_NOT_FOUND` already follows).
   */
  async revokeSession(accessToken: string, tokenId: string): Promise<RevokeSessionResponse> {
    return this.request<RevokeSessionResponse>(
      `${this.apiBaseUrl}/auth/sessions/${encodeURIComponent(tokenId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }

  /**
   * `POST /auth/sessions/revoke-all` — Phase 2 Step 7. Revokes every
   * one of the caller's sessions *except* the one currently making this
   * call, so "sign out everywhere else" never locks the caller out of
   * their own active session.
   */
  async revokeAllSessions(accessToken: string): Promise<RevokeAllSessionsResponse> {
    return this.request<RevokeAllSessionsResponse>(`${this.apiBaseUrl}/auth/sessions/revoke-all`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  }

  /**
   * POSTs a JSON body to an `apps/api` route and unwraps the shared
   * `ApiSuccess`/`ApiError` envelope via `request()`.
   */
  private async postJson<TRequest, TResponse>(
    path: string,
    body: TRequest,
  ): Promise<TResponse> {
    return this.request<TResponse>(`${this.apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Sends a request to an `apps/api` route and unwraps the shared
   * `ApiSuccess`/`ApiError` envelope. On failure — either a non-2xx
   * status or (defensively) a `success: false` body on a 2xx status —
   * throws `ApiClientError` with the backend's structured `code` and
   * per-field `details` intact, so callers (`apps/web` forms) can react
   * to the failure mode instead of just a generic message string.
   *
   * A response body that isn't valid JSON (e.g. an upstream proxy error
   * page) is treated the same as a network failure: it never reaches
   * the caller as a confusing parse exception.
   */
  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch {
      throw new ApiClientError({
        code: "NETWORK_ERROR",
        message: "Could not reach the server. Check your connection and try again.",
        status: 0,
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ApiClientError({
        code: "INVALID_RESPONSE",
        message: `Request to ${url} returned an unreadable response (status ${response.status}).`,
        status: response.status,
      });
    }

    const isSuccessEnvelope =
      json !== null && typeof json === "object" && (json as { success?: unknown }).success === true;

    if (!response.ok || !isSuccessEnvelope) {
      const errorBody = json as
        | { error?: { code?: unknown; message?: unknown; details?: unknown } }
        | null;
      const code =
        typeof errorBody?.error?.code === "string" ? errorBody.error.code : "UNKNOWN_ERROR";
      const message =
        typeof errorBody?.error?.message === "string"
          ? errorBody.error.message
          : `Request to ${url} failed with status ${response.status}`;
      throw new ApiClientError({ code, message, status: response.status, details: errorBody?.error?.details });
    }

    return (json as { data: T }).data;
  }
}
