import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import type {
  ChangePasswordResponse,
  DeleteAccountResponse,
  UpdateProfileResponse,
} from "@omniscience/types";
import { PasswordHasherService } from "../auth/password-hasher.service";
import { RefreshTokenStore } from "../auth/refresh-token.store";
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
    return { id: updated.id, email: updated.email, name: updated.name };
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

    return { deleted: true };
  }

  private staleSessionError(): UnauthorizedException {
    return new UnauthorizedException({
      code: "UNAUTHORIZED",
      message: "A valid access token is required.",
    });
  }
}
