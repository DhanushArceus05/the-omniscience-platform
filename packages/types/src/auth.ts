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
