import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import type {
  ChangePasswordResponse,
  DeleteAccountResponse,
  DeleteAvatarResponse,
  UpdateProfileResponse,
  UploadAvatarResponse,
} from "@omniscience/types";
import { PasswordHasherService } from "../auth/password-hasher.service";
import { RefreshTokenStore } from "../auth/refresh-token.store";
import { AvatarStorageService, type AvatarUploadInput } from "../avatar/avatar-storage.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Orchestrates the Phase 2 Step 6 user-profile flow (updating the
 * authenticated user's own display name, and changing their password
 * while already logged in) plus Phase 2 Step 8's account deletion.
 *
 * Every operation acts only on the caller's own account — the user id
 * comes exclusively from the verified JWT payload `JwtAuthGuard`
 * attaches (`AccessTokenPayload.sub`), passed in by
 * `UsersController`, never from a request body or query param. There is
 * no "update/delete someone else's profile" capability here or anywhere
 * else in this step; that would be an admin capability, out of scope
 * (see `docs/08_Development_Roadmap.md`'s later "Admin, Security &
 * Reliability" phase).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly avatarStorage: AvatarStorageService,
  ) {}

  async updateProfile(userId: string, name: string): Promise<UpdateProfileResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      // The account was deleted after the caller's access token was
      // issued but before it expired — same scenario and same response
      // `AuthService.getCurrentUser` (Step 4) already uses for `/auth/me`.
      throw this.staleSessionError();
    }

    const updated = await this.prisma.user.update({ where: { id: userId }, data: { name } });
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      avatarUrl: this.toAvatarUrl(updated.avatarStorageKey),
    };
  }

  /**
   * Phase 3 Step 3 — uploads (or replaces) the caller's own avatar.
   * `AvatarStorageService.save` already validates size/MIME/magic-bytes
   * and writes the new file *before* anything here touches the
   * database, so a validation failure never leaves the user's row
   * pointing at a partially-written or nonexistent file. The old
   * avatar (if any) is deleted only *after* the new one is safely
   * persisted and the row updated — never the other way around, so a
   * failure partway through can never leave the account with no avatar
   * file at all when it previously had one.
   */
  async uploadAvatar(userId: string, input: AvatarUploadInput): Promise<UploadAvatarResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw this.staleSessionError();
    }

    // Captured before `update()` runs: `PrismaService.user.update` (and
    // this repo's e2e `FakePrismaService` stand-in even more so, since
    // it mutates the same row object `findUnique` handed back) must
    // never be trusted not to mutate/refresh the `user` object in
    // place. Reading `avatarStorageKey` off `user` *after* the update
    // call would silently pick up the *new* key instead of the old one
    // whenever that happens, permanently skipping the old file's
    // deletion.
    const previousStorageKey = user.avatarStorageKey;

    const stored = await this.avatarStorage.save(input);
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarStorageKey: stored.storageKey },
    });

    if (previousStorageKey && previousStorageKey !== stored.storageKey) {
      await this.avatarStorage.delete(previousStorageKey);
    }

    return { avatarUrl: stored.publicUrl };
  }

  /**
   * Phase 3 Step 3 — removes the caller's own avatar, if any. Always
   * succeeds (a no-op if there wasn't one), the same
   * "already-in-the-target-state is not an error" convention
   * `AuthService.logout`/`RefreshTokenStore.revoke` already establish
   * for idempotent actions.
   */
  async deleteAvatar(userId: string): Promise<DeleteAvatarResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw this.staleSessionError();
    }

    // Same reasoning as `uploadAvatar`: capture the key before
    // `update()` runs rather than reading `user.avatarStorageKey`
    // afterward, since a caller must never assume `user` is left
    // untouched by a subsequent `update()` call.
    const storageKey = user.avatarStorageKey;
    if (storageKey) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarStorageKey: null },
      });
      await this.avatarStorage.delete(storageKey);
    }

    return { avatarUrl: null };
  }

  /**
   * Changes the caller's password, asserting their *current* password
   * first — distinct from Step 5's `resetPassword`, which is
   * unauthenticated and OTP-gated instead. Requiring the current
   * password here means a bare stolen/leaked access token alone (valid
   * for only `JWT_ACCESS_TTL_SECONDS`, 15 minutes by default) is not
   * enough to lock the real owner out by changing their password.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<ChangePasswordResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw this.staleSessionError();
    }

    const isCurrentPasswordValid = await this.passwordHasher.verify(
      user.passwordHash,
      currentPassword,
    );
    if (!isCurrentPasswordValid) {
      throw new BadRequestException({
        code: "CURRENT_PASSWORD_INCORRECT",
        message: "The current password is incorrect.",
      });
    }

    // Same rule and same shared check `AuthService.resetPassword`
    // (Step 5) applies for its OTP-gated flow — a "changed" password
    // that's identical to the old one isn't a real credential change.
    await this.passwordHasher.assertDiffersFromCurrent(user.passwordHash, newPassword);

    const passwordHash = await this.passwordHasher.hash(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    return { email: user.email };
  }

  /**
   * Phase 2 Step 8 — permanently deletes the caller's own account.
   * Irreversible: there is no soft-delete, grace period, or restore
   * path. Requires the current password first, for the same reason
   * `changePassword` does (a bare stolen/leaked access token alone must
   * not be enough to destroy the account) — reuses the exact
   * `CURRENT_PASSWORD_INCORRECT` code `changePassword` already
   * established for this identical check, rather than inventing a
   * second name for the same failure.
   *
   * Order matters: the `User` row is deleted first — that row's
   * existence is what every other endpoint's authorization actually
   * depends on (e.g. `refresh()`'s existing re-check that the user
   * still exists), so deleting it is what makes the account gone in
   * every sense that matters, immediately. `revokeAllForUser` runs
   * after, on a best-effort basis, purely to free the now-orphaned
   * Redis session records promptly rather than leaving them to expire
   * on their own TTL — even if this second step were somehow skipped,
   * every one of those refresh tokens would already fail on its next
   * use, since `refresh()` re-checks the user exists before honoring
   * one. See `RefreshTokenStore`'s Step 7 session-index docstring for
   * why the index itself is never authoritative.
   */
  async deleteAccount(userId: string, password: string): Promise<DeleteAccountResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw this.staleSessionError();
    }

    const isPasswordValid = await this.passwordHasher.verify(user.passwordHash, password);
    if (!isPasswordValid) {
      throw new BadRequestException({
        code: "CURRENT_PASSWORD_INCORRECT",
        message: "The current password is incorrect.",
      });
    }

    await this.prisma.user.delete({ where: { id: userId } });
    await this.refreshTokens.revokeAllForUser(userId);
    // Best-effort, same as the session-revocation line above: the User
    // row (the only thing that actually matters for "is this account
    // gone") is already deleted by this point regardless of whether
    // this file cleanup succeeds.
    await this.avatarStorage.delete(user.avatarStorageKey);

    return { deleted: true };
  }

  private toAvatarUrl(avatarStorageKey: string | null): string | null {
    return avatarStorageKey ? this.avatarStorage.buildPublicUrl(avatarStorageKey) : null;
  }

  private staleSessionError(): UnauthorizedException {
    return new UnauthorizedException({
      code: "UNAUTHORIZED",
      message: "A valid access token is required.",
    });
  }
}