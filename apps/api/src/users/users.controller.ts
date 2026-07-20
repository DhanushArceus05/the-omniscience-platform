import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
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
  DeleteAvatarResponse,
  UpdateProfileResponse,
  UploadAvatarResponse,
} from "@omniscience/types";
import type { AccessTokenPayload } from "../auth/access-token.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MulterExceptionFilter } from "../avatar/multer-exception.filter";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { UsersService } from "./users.service";

/**
 * A fixed, generous backstop against extreme abuse during multipart
 * upload streaming — NOT the authoritative avatar size limit. That
 * limit is `AVATAR_MAX_UPLOAD_BYTES` (env-configurable, default 5MB),
 * enforced by `AvatarStorageService.assertValid` after the file is
 * buffered. This constant only exists so a client can't stream an
 * arbitrarily large body at this endpoint before that check ever runs;
 * it deliberately is not read from config, so it never has to be kept
 * in sync with `AVATAR_MAX_UPLOAD_BYTES` — it only needs to be safely
 * larger than any real-world avatar (a 10th of a typical phone photo).
 */
const MULTER_UPLOAD_BACKSTOP_BYTES = 8 * 1024 * 1024;

/**
 * A minimal Multer file shape — only the fields this controller and
 * `AvatarStorageService` actually read. Avoids depending on
 * `@types/multer`'s full `Express.Multer.File` merely for typing a
 * parameter, matching this codebase's general preference for narrow,
 * explicit interfaces over pulling in a whole ambient type.
 */
interface UploadedAvatarFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * User-profile endpoints: `PATCH /users/me` (update display name, Step
 * 6), `POST /users/me/change-password` (change password while
 * authenticated, Step 6), `DELETE /users/me` (permanently delete the
 * account, Step 8), and — Phase 3 Step 3 — `POST /users/me/avatar` /
 * `DELETE /users/me/avatar`. All sit behind `JwtAuthGuard` (Step 4) and
 * always act on the caller's own account via `AccessTokenPayload.sub` —
 * there is no id/email path or body param that could target a
 * different user; ownership is never accepted from client input.
 *
 * Throttled per-IP on top of `JwtAuthGuard`'s own auth check, same
 * defense-in-depth pattern `AuthController` already uses:
 * `change-password` gets the same 10/10min limit as `/auth/reset-
 * password` (a comparably sensitive credential-changing action);
 * `update-profile` (name only, no credential involved) gets a looser
 * 20/10min limit, matching `/auth/refresh`/`/auth/logout`; account
 * deletion gets the tightest existing precedent, 3/10min (same as
 * `/auth/forgot-password`), appropriate for the single most
 * irreversible action in the whole API. The avatar endpoints get their
 * own 20/10min limit, matching `update-profile` — a comparable,
 * non-credential profile edit, just a heavier one.
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

  /**
   * Phase 3 Step 3 — uploads (or replaces) the caller's own avatar.
   * `multipart/form-data`, a single `file` field — see
   * `UsersService.uploadAvatar`/`AvatarStorageService.save` for the
   * full validation chain (size, declared MIME type, and the file's
   * actual magic bytes all checked independently). `MulterExceptionFilter`
   * translates the one failure mode Multer itself can raise before any
   * of that code runs (exceeding the fixed upload backstop above) into
   * the same structured error envelope every other failure here uses.
   */
  @Post("me/avatar")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MULTER_UPLOAD_BACKSTOP_BYTES } }))
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async uploadAvatar(
    @CurrentUser() user: AccessTokenPayload,
    @UploadedFile() file: UploadedAvatarFile | undefined,
  ): Promise<ApiSuccess<UploadAvatarResponse>> {
    if (!file) {
      throw new UnsupportedMediaTypeException({
        code: "AVATAR_TYPE_UNSUPPORTED",
        message: "No file was uploaded. Attach a JPEG, PNG, or WebP image as `file`.",
      });
    }
    const data = await this.usersService.uploadAvatar(user.sub, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
    });
    return { success: true, data };
  }

  /** Phase 3 Step 3 — removes the caller's own avatar, if any. Always succeeds. */
  @Delete("me/avatar")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  async deleteAvatar(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<ApiSuccess<DeleteAvatarResponse>> {
    const data = await this.usersService.deleteAvatar(user.sub);
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
