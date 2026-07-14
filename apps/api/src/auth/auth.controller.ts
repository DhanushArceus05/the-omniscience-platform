import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  registerRequestSchema,
  resendOtpRequestSchema,
  verifyOtpRequestSchema,
  type RegisterRequestSchema,
  type ResendOtpRequestSchema,
  type VerifyOtpRequestSchema,
} from "@omniscience/schemas";
import type {
  ApiSuccess,
  RegisterResponse,
  ResendOtpResponse,
  VerifyOtpResponse,
} from "@omniscience/types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";

/**
 * Registration + OTP verification endpoints (Phase 2 Step 3).
 *
 * No login, JWT issuance, or forgot/reset-password endpoints here —
 * those are Step 4/5. Each endpoint is additionally throttled per-IP
 * (on top of AuthService's own per-email resend cooldown) as defense in
 * depth against abuse from a single source hitting many different
 * emails.
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
}
