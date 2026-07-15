/**
 * Request/response contracts for the Phase 2 Step 6 user-profile
 * endpoints: updating the authenticated user's own display name, and
 * changing their password while already logged in (distinct from
 * Step 5's unauthenticated, OTP-gated forgot-password/reset-password
 * flow — this one asserts the *current* password instead).
 */
export interface UpdateProfileRequest {
  name: string;
}

export interface UpdateProfileResponse {
  id: string;
  email: string;
  name: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  email: string;
}
