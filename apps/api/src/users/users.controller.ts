import { Body, Controller, HttpCode, HttpStatus, Patch, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  changePasswordRequestSchema,
  updateProfileRequestSchema,
  type ChangePasswordRequestSchema,
  type UpdateProfileRequestSchema,
} from "@omniscience/schemas";
import type {
  ApiSuccess,
  ChangePasswordResponse,
  UpdateProfileResponse,
} from "@omniscience/types";
import type { AccessTokenPayload } from "../auth/access-token.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { UsersService } from "./users.service";

/**
 * User-profile endpoints (Phase 2 Step 6): `PATCH /users/me` (update
 * display name) and `POST /users/me/change-password` (change password
 * while authenticated). Both routes sit behind `JwtAuthGuard` (Step 4)
 * and always act on the caller's own account via
 * `AccessTokenPayload.sub` — there is no id/email path or body param
 * that could target a different user.
 *
 * Throttled per-IP on top of `JwtAuthGuard`'s own auth check, same
 * defense-in-depth pattern `AuthController` already uses:
 * `change-password` gets the same 10/10min limit as `/auth/reset-
 * password` (a comparably sensitive credential-changing action);
 * `update-profile` (name only, no credential involved) gets a looser
 * 20/10min limit, matching `/auth/refresh`/`/auth/logout`.
 */
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch("me")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async updateProfile(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(updateProfileRequestSchema)) body: UpdateProfileRequestSchema,
  ): Promise<ApiSuccess<UpdateProfileResponse>> {
    const data = await this.usersService.updateProfile(user.sub, body.name);
    return { success: true, data };
  }

  @Post("me/change-password")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async changePassword(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequestSchema,
  ): Promise<ApiSuccess<ChangePasswordResponse>> {
    const data = await this.usersService.changePassword(
      user.sub,
      body.currentPassword,
      body.newPassword,
    );
    return { success: true, data };
  }
}
