import type {
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  HealthCheckResponse,
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
