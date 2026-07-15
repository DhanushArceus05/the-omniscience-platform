/**
 * Request/response contracts for the Phase 2 registration + OTP
 * verification flow (Step 3). JWT issuance (login) is Step 4 — these
 * endpoints intentionally return no tokens, only enough information to
 * drive the existing RegisterPage/VerifyOtpPage UI.
 */
export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface RegisterResponse {
  email: string;
  otpExpiresInSeconds: number;
}

export interface VerifyOtpRequest {
  email: string;
  otp: string;
}

export interface VerifyOtpResponse {
  userId: string;
  email: string;
}

export interface ResendOtpRequest {
  email: string;
}

export interface ResendOtpResponse {
  email: string;
  otpExpiresInSeconds: number;
}

/**
 * Phase 2 Step 4 — login, JWT access/refresh token issuance, refresh,
 * logout, and the current-session identity check.
 *
 * The access token is a short-lived, stateless JWT (`JWT_ACCESS_TTL_SECONDS`,
 * default 15m) carrying just enough to authenticate a request. The refresh
 * token is an opaque, high-entropy secret (default 7d) — never a JWT —
 * whose hash is stored server-side in Redis so it can be looked up,
 * rotated, and revoked; only its hash ever touches storage, matching the
 * OTP-hashing pattern already used in Step 3.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenExpiresInSeconds: number;
  user: AuthenticatedUser;
}

export interface RefreshRequest {
  refreshToken: string;
}

/** Refresh always rotates: the request's refresh token is single-use, and a new one is returned alongside the new access token. */
export interface RefreshResponse {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenExpiresInSeconds: number;
}

export interface LogoutRequest {
  refreshToken: string;
}

export interface LogoutResponse {
  loggedOut: true;
}

export type MeResponse = AuthenticatedUser;

/**
 * Phase 2 Step 5 — forgot-password and reset-password.
 *
 * Follows the same OTP-over-email pattern as registration (Step 3)
 * rather than a mailed reset link/token, per the SRS ("forgot-password
 * OTP"). `forgotPassword` always responds with the same shape whether or
 * not the email is registered — the response alone must never reveal
 * account existence.
 */
export interface ForgotPasswordRequest {
  email: string;
}

export interface ForgotPasswordResponse {
  email: string;
  otpExpiresInSeconds: number;
}

export interface ResetPasswordRequest {
  email: string;
  otp: string;
  newPassword: string;
}

export interface ResetPasswordResponse {
  email: string;
}
