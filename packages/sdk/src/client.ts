import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  CreateConversationResponse,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  DeleteAccountRequest,
  DeleteAccountResponse,
  DeleteAvatarResponse,
  DeleteConversationResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  GetConversationResponse,
  GetWorkspaceResponse,
  HealthCheckResponse,
  ListConversationsQuery,
  ListConversationsResponse,
  ListMessagesQuery,
  ListMessagesResponse,
  ListSessionsResponse,
  ListWorkspacesQuery,
  ListWorkspacesResponse,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  LogoutResponse,
  MeResponse,
  MessageStreamEvent,
  RefreshRequest,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  RenameConversationResponse,
  ResendOtpRequest,
  ResendOtpResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  RevokeAllSessionsResponse,
  RevokeSessionResponse,
  SendMessageResponse,
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

  /**
   * `POST /workspaces/:workspaceId/conversations` — Phase 6 Step 1.
   * Creates a conversation in a workspace the caller owns (ownership
   * is verified server-side, never from `workspaceId` alone). Every
   * conversation is created with `title: null` — this step has no
   * rename or auto-title endpoint yet.
   */
  async createConversation(accessToken: string, workspaceId: string): Promise<CreateConversationResponse> {
    return this.request<CreateConversationResponse>(
      `${this.apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/conversations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({}),
      },
    );
  }

  /**
   * `GET /workspaces/:workspaceId/conversations` — Phase 6 Step 1.
   * Bounded, keyset-paginated list of the caller's own conversations
   * within one workspace, newest first — same pagination contract as
   * `listWorkspaces()`.
   */
  async listConversations(
    accessToken: string,
    workspaceId: string,
    query?: ListConversationsQuery,
  ): Promise<ListConversationsResponse> {
    const params = new URLSearchParams();
    if (query?.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    if (query?.cursor) {
      params.set("cursor", query.cursor);
    }
    const queryString = params.toString();
    return this.request<ListConversationsResponse>(
      `${this.apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/conversations${
        queryString ? `?${queryString}` : ""
      }`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }

  /**
   * `GET /workspaces/:workspaceId/conversations/:conversationId` —
   * Phase 6 Step 1. Throws `ApiClientError` with
   * `code: "CONVERSATION_NOT_FOUND"` (404) whether the id doesn't
   * exist at all, belongs to a different owner, or belongs to a
   * different workspace — identical either way, by design, on the
   * backend, same no-enumeration convention `getWorkspace()` already
   * follows.
   */
  async getConversation(
    accessToken: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<GetConversationResponse> {
    return this.request<GetConversationResponse>(
      `${this.apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }

  /**
   * `PATCH /workspaces/:workspaceId/conversations/:conversationId` —
   * Phase 6 Step 4 (Conversation Management). Same
   * `CONVERSATION_NOT_FOUND` no-enumeration convention as
   * `getConversation()` above.
   */
  async renameConversation(
    accessToken: string,
    workspaceId: string,
    conversationId: string,
    title: string,
  ): Promise<RenameConversationResponse> {
    return this.request<RenameConversationResponse>(
      `${this.apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ title }),
      },
    );
  }

  /**
   * `DELETE /workspaces/:workspaceId/conversations/:conversationId` —
   * Phase 6 Step 4 (Conversation Management). Irreversible — cascades
   * to every message the conversation owned server-side (see
   * `apps/api`'s `ConversationsRepository.deleteConversation()` doc
   * comment). Same `CONVERSATION_NOT_FOUND` no-enumeration convention
   * as `getConversation()` above.
   */
  async deleteConversation(
    accessToken: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<DeleteConversationResponse> {
    return this.request<DeleteConversationResponse>(
      `${this.apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }

  /**
   * `GET /workspaces/:workspaceId/conversations/:conversationId/messages`
   * — Phase 6 Step 1. Bounded, keyset-paginated reload of a
   * conversation's messages in chronological (oldest-first) order —
   * reading order, not newest-first like `listConversations()`.
   */
  async listMessages(
    accessToken: string,
    workspaceId: string,
    conversationId: string,
    query?: ListMessagesQuery,
  ): Promise<ListMessagesResponse> {
    const params = new URLSearchParams();
    if (query?.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    if (query?.cursor) {
      params.set("cursor", query.cursor);
    }
    const queryString = params.toString();
    return this.request<ListMessagesResponse>(
      `${this.apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages${
        queryString ? `?${queryString}` : ""
      }`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }

  /**
   * `POST /workspaces/:workspaceId/conversations/:conversationId/messages`
   * — Phase 6 Step 1. Sends `content` through the backend's existing
   * `OmniCoreService.execute()` pipeline and returns both the
   * persisted user message and the persisted assistant reply. If
   * OmniCore execution fails, this throws the same `ApiClientError`
   * shape any other OmniCore domain error would (e.g.
   * `AMBIGUOUS_INTENT`) — the user's message is still persisted
   * server-side even though this call rejects; a subsequent
   * `listMessages()` call will include it.
   */
  async sendMessage(
    accessToken: string,
    workspaceId: string,
    conversationId: string,
    content: string,
  ): Promise<SendMessageResponse> {
    return this.request<SendMessageResponse>(
      `${this.apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ content }),
      },
    );
  }

  /**
   * `POST /workspaces/:workspaceId/conversations/:conversationId/messages/stream`
   * — Phase 6 Step 2. The authenticated, `fetch()`-based streaming
   * counterpart to `sendMessage()`. Deliberately not built on the
   * native `EventSource` API: `EventSource` can only issue
   * unauthenticated `GET` requests, so it has no way to attach the
   * `Authorization` header this endpoint requires (and offers no real
   * reconnection guarantee worth relying on regardless) — see
   * `apps/api`'s `ConversationsController.sendMessageStream` doc
   * comment for the server-side half of this same reasoning.
   *
   * An async generator of typed `MessageStreamEvent`s, in the exact
   * order the server emits them: one `start`, zero or more `delta`,
   * then exactly one `done` or `error` ends the stream. Robust to the
   * two ways SSE bytes can be chopped by the network — a single
   * logical frame split across multiple `fetch` chunks, and multiple
   * complete frames delivered together in one chunk — via
   * `parseIncrementalSseFrames`, which only ever emits a frame once a
   * complete `\n\n`-terminated block has accumulated in its buffer,
   * decoding with `TextDecoder`'s own `{ stream: true }` mode so a
   * multi-byte UTF-8 character split across chunk boundaries is never
   * mis-decoded either.
   *
   * A well-formed `error` event from the server is **yielded**, not
   * thrown — the same terminal domain codes (e.g.
   * `EXECUTION_CANCELLED`, a mapped provider failure)
   * `sendMessage()`'s `ApiClientError.code` would already carry are
   * available on `event.data.code` for a caller that wants to `switch`
   * on `event.event` uniformly instead of wrapping this call in a
   * separate try/catch for exactly one branch. A non-2xx response
   * *before* any SSE framing begins (a 401, 404, 429, or similar) still
   * throws `ApiClientError`, identically to every other method on this
   * client — that's an ordinary HTTP error response, not a stream
   * event, exactly mirroring the endpoint's own "LOCKED ERROR
   * SEMANTICS": headers for SSE are never opened server-side until
   * everything that can still fail with a normal HTTP status already
   * has. A malformed frame this client can't parse (unparsable `data:`
   * JSON) throws `ApiClientError` with `code: "INVALID_RESPONSE"`
   * rather than letting a raw `JSON.parse` exception escape; an
   * `event:` name this client doesn't recognize is skipped rather than
   * thrown on, so a future server-added event type doesn't break an
   * already-shipped client.
   *
   * `options.signal`, if given, aborts the underlying `fetch` — the
   * same signal a caller would pass to cancel any other in-flight
   * `fetch` call.
   */
  async *sendMessageStream(
    accessToken: string,
    workspaceId: string,
    conversationId: string,
    content: string,
    options: { readonly signal?: AbortSignal } = {},
  ): AsyncGenerator<MessageStreamEvent> {
    const url = `${this.apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages/stream`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ content }),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        // Not a network failure — the caller asked to stop. Let the
        // `AbortError` (or whatever `fetchImpl` throws for an aborted
        // request) propagate as-is, rather than reporting it as a
        // misleading `NETWORK_ERROR`.
        throw error;
      }
      throw new ApiClientError({
        code: "NETWORK_ERROR",
        message: "Could not reach the server. Check your connection and try again.",
        status: 0,
      });
    }

    if (!response.ok) {
      // Ordinary HTTP error response — SSE headers were never opened
      // server-side — so the body is the same `ApiError` envelope every
      // other method on this client already unwraps.
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

    if (!response.body) {
      throw new ApiClientError({
        code: "INVALID_RESPONSE",
        message: `Request to ${url} succeeded but returned no readable stream body.`,
        status: response.status,
      });
    }

    yield* parseIncrementalSseFrames(response.body, url);
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

/** Every `event:` name `MessageStreamEvent` (Phase 6 Step 2) declares — anything else in a frame's `event:` line is treated as forward-compatible and skipped, not thrown on. */
const KNOWN_STREAM_EVENT_NAMES: ReadonlySet<string> = new Set(["start", "delta", "done", "error"]);

/**
 * Reads `body` incrementally and yields one `MessageStreamEvent` per
 * complete SSE frame (`event: ...\ndata: ...\n\n`), used by
 * `sendMessageStream()`. Kept as a standalone function, not a private
 * method, so it depends on nothing from `OmniscienceClient` beyond the
 * two arguments it's given — the whole point of pulling this out of
 * the method body is that it's the one piece worth unit testing with a
 * hand-built `ReadableStream` feeding it arbitrary chunk boundaries,
 * with no `OmniscienceClient` instance, `fetch`, or network involved
 * at all.
 *
 * Buffers raw decoded text across reads (`TextDecoder`'s own
 * `{ stream: true }` mode, so a multi-byte UTF-8 character split
 * across two chunks is never mis-decoded) and only ever emits a frame
 * once a full `\n\n`-terminated block has accumulated — correct
 * whether the network hands this a frame in one piece, split across
 * many small reads, or several complete frames concatenated into one
 * read.
 */
async function* parseIncrementalSseFrames(
  body: ReadableStream<Uint8Array>,
  url: string,
): AsyncGenerator<MessageStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseStreamFrame(rawFrame, url);
        if (event) {
          yield event;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    // A well-behaved server (this one included) always terminates its
    // final frame with the required trailing blank line before closing
    // the connection, so `buffer` is normally empty by this point.
    // Handling one last non-terminated frame defensively costs nothing
    // and avoids silently dropping data from a server that closes the
    // connection a moment early.
    const trailing = buffer.trim();
    if (trailing.length > 0) {
      const event = parseStreamFrame(trailing, url);
      if (event) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parses one already-isolated SSE frame's raw text (no trailing blank
 * line) into a `MessageStreamEvent`, or `null` for a frame this client
 * intentionally ignores (no recognized `event:` line — either a
 * blank/comment-only frame, or a future event name this client version
 * doesn't know about yet). Throws `ApiClientError` (`code:
 * "INVALID_RESPONSE"`) for a frame that *does* name a known event but
 * whose `data:` line(s) aren't valid JSON — that's not something a
 * caller should have to defend against per-event, so it fails loudly
 * here instead of handing a caller a broken partial `MessageStreamEvent`.
 */
function parseStreamFrame(rawFrame: string, url: string): MessageStreamEvent | null {
  let eventName: string | null = null;
  const dataLines: string[] = [];

  for (const line of rawFrame.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (!eventName || !KNOWN_STREAM_EVENT_NAMES.has(eventName)) {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    throw new ApiClientError({
      code: "INVALID_RESPONSE",
      message: `Request to ${url} sent a malformed "${eventName}" stream event.`,
      status: 200,
    });
  }

  return { event: eventName, data } as MessageStreamEvent;
}
