import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  changePasswordRequestSchema,
  deleteAccountRequestSchema,
  updateProfileRequestSchema,
  type ChangePasswordRequestSchema,
  type DeleteAccountRequestSchema,
  type UpdateProfileRequestSchema,
} from "@omniscience/schemas";
import type {
  ApiSuccess,
  ChangePasswordResponse,
  DeleteAccountResponse,
  UpdateProfileResponse,
} from "@omniscience/types";
import type { AccessTokenPayload } from "../auth/access-token.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { UsersService } from "./users.service";

/**
 * User-profile endpoints: `PATCH /users/me` (update display name, Step
 * 6), `POST /users/me/change-password` (change password while
 * authenticated, Step 6), and `DELETE /users/me` (permanently delete
 * the account, Step 8). All three sit behind `JwtAuthGuard` (Step 4)
 * and always act on the caller's own account via
 * `AccessTokenPayload.sub` — there is no id/email path or body param
 * that could target a different user.
 *
 * Throttled per-IP on top of `JwtAuthGuard`'s own auth check, same
 * defense-in-depth pattern `AuthController` already uses:
 * `change-password` gets the same 10/10min limit as `/auth/reset-
 * password` (a comparably sensitive credential-changing action);
 * `update-profile` (name only, no credential involved) gets a looser
 * 20/10min limit, matching `/auth/refresh`/`/auth/logout`; account
 * deletion gets the tightest existing precedent, 3/10min (same as
 * `/auth/forgot-password`), appropriate for the single most
 * irreversible action in the whole API.
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

  /**
   * Phase 2 Step 8 — permanently deletes the caller's own account.
   * Requires the current password in the body (same reasoning as
   * `changePassword` above); the tightest `@Throttle` limit in this
   * controller, matching `/auth/forgot-password`'s 3/10min.
   */
  @Delete("me")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  async deleteAccount(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(deleteAccountRequestSchema)) body: DeleteAccountRequestSchema,
  ): Promise<ApiSuccess<DeleteAccountResponse>> {
    const data = await this.usersService.deleteAccount(user.sub, body.password);
    return { success: true, data };
  }
}
