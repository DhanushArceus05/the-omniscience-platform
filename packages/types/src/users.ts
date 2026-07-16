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

/**
 * Phase 2 Step 8 — account deletion. Requires the caller's current
 * password (same reasoning `ChangePasswordRequest.currentPassword`
 * documents: a bare stolen/leaked access token alone must not be
 * enough to destroy the account). Irreversible — there is no "undo" or
 * grace-period endpoint.
 */
export interface DeleteAccountRequest {
  password: string;
}

export interface DeleteAccountResponse {
  deleted: true;
}
