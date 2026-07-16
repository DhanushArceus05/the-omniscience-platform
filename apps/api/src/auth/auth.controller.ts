import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  resendOtpRequestSchema,
  resetPasswordRequestSchema,
  sessionTokenIdSchema,
  verifyOtpRequestSchema,
  type ForgotPasswordRequestSchema,
  type LoginRequestSchema,
  type LogoutRequestSchema,
  type RefreshRequestSchema,
  type RegisterRequestSchema,
  type ResendOtpRequestSchema,
  type ResetPasswordRequestSchema,
  type VerifyOtpRequestSchema,
} from "@omniscience/schemas";
import type {
  ApiSuccess,
  ForgotPasswordResponse,
  ListSessionsResponse,
  LoginResponse,
  LogoutResponse,
  MeResponse,
  RefreshResponse,
  RegisterResponse,
  ResendOtpResponse,
  ResetPasswordResponse,
  RevokeAllSessionsResponse,
  RevokeSessionResponse,
  VerifyOtpResponse,
} from "@omniscience/types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenPayload } from "./access-token.service";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * Authentication endpoints (Phase 2 Steps 3, 4 + 5).
 *
 * Step 3: registration + OTP verification (`/register`, `/verify-otp`,
 * `/resend-otp`).
 * Step 4: login, refresh, logout, and the current-session identity check
 * (`/login`, `/refresh`, `/logout`, `/me`).
 * Step 5 (this step): forgot-password + reset-password
 * (`/forgot-password`, `/reset-password`).
 * Step 7: session management — list/revoke the caller's own active
 * sessions (`/sessions`, `/sessions/:tokenId`, `/sessions/revoke-all`).
 *
 * Each endpoint is additionally throttled per-IP (on top of any
 * per-account/per-token business rule `AuthService` itself enforces) as
 * defense in depth against abuse from a single source. `/login` and
 * `/refresh` get the tightest limits here since they're the most
 * attractive brute-force/credential-stuffing targets; there is no
 * separate per-account lockout in this step (not required by the
 * approved scope — see known limitations).
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequestSchema,
  ): Promise<ApiSuccess<RegisterResponse>> {
    const data = await this.authService.register(body);
    return { success: true, data };
  }

  @Post("verify-otp")
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpRequestSchema)) body: VerifyOtpRequestSchema,
  ): Promise<ApiSuccess<VerifyOtpResponse>> {
    const data = await this.authService.verifyOtp(body.email, body.otp);
    return { success: true, data };
  }

  @Post("resend-otp")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  async resendOtp(
    @Body(new ZodValidationPipe(resendOtpRequestSchema)) body: ResendOtpRequestSchema,
  ): Promise<ApiSuccess<ResendOtpResponse>> {
    const data = await this.authService.resendOtp(body.email);
    return { success: true, data };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequestSchema,
  ): Promise<ApiSuccess<LoginResponse>> {
    const data = await this.authService.login(body.email, body.password);
    return { success: true, data };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequestSchema,
  ): Promise<ApiSuccess<RefreshResponse>> {
    const data = await this.authService.refresh(body.refreshToken);
    return { success: true, data };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async logout(
    @Body(new ZodValidationPipe(logoutRequestSchema)) body: LogoutRequestSchema,
  ): Promise<ApiSuccess<LogoutResponse>> {
    const data = await this.authService.logout(body.refreshToken);
    return { success: true, data };
  }

  @Get("me")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AccessTokenPayload): Promise<ApiSuccess<MeResponse>> {
    const data = await this.authService.getCurrentUser(user.sub);
    return { success: true, data };
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema)) body: ForgotPasswordRequestSchema,
  ): Promise<ApiSuccess<ForgotPasswordResponse>> {
    const data = await this.authService.forgotPassword(body.email);
    return { success: true, data };
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema)) body: ResetPasswordRequestSchema,
  ): Promise<ApiSuccess<ResetPasswordResponse>> {
    const data = await this.authService.resetPassword(body.email, body.otp, body.newPassword);
    return { success: true, data };
  }

  /**
   * Phase 2 Step 7 — lists the caller's own active sessions, newest
   * first. Same `@Throttle` limit as `/auth/refresh`/`/auth/logout`
   * (Step 4) — no credential is involved, just an authenticated read.
   */
  @Get("sessions")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async listSessions(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ApiSuccess<ListSessionsResponse>> {
    const data = await this.authService.listSessions(user.sub);
    return { success: true, data };
  }

  /**
   * Phase 2 Step 7 — revokes exactly one of the caller's own sessions.
   * `tokenId` is validated as a UUID by `sessionTokenIdSchema` before it
   * ever reaches `AuthService`/`RefreshTokenStore`.
   */
  @Delete("sessions/:tokenId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async revokeSession(
    @CurrentUser() user: AccessTokenPayload,
    @Param("tokenId", new ZodValidationPipe(sessionTokenIdSchema)) tokenId: string,
  ): Promise<ApiSuccess<RevokeSessionResponse>> {
    const data = await this.authService.revokeSession(user.sub, tokenId);
    return { success: true, data };
  }

  /**
   * Phase 2 Step 7 — revokes every active session for the caller ("log
   * out everywhere"). Same `@Throttle` limit as `/auth/reset-password`
   * (Step 5) — a comparably sensitive, account-wide action.
   */
  @Post("sessions/revoke-all")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async revokeAllSessions(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ApiSuccess<RevokeAllSessionsResponse>> {
    const data = await this.authService.revokeAllSessions(user.sub);
    return { success: true, data };
  }
}
