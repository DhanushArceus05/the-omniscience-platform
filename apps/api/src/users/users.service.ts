import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ChangePasswordResponse, UpdateProfileResponse } from "@omniscience/types";
import { PasswordHasherService } from "../auth/password-hasher.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Orchestrates the Phase 2 Step 6 user-profile flow: updating the
 * authenticated user's own display name, and changing their password
 * while already logged in.
 *
 * Both operations act only on the caller's own account — the user id
 * comes exclusively from the verified JWT payload `JwtAuthGuard`
 * attaches (`AccessTokenPayload.sub`), passed in by
 * `UsersController`, never from a request body or query param. There is
 * no "update someone else's profile" capability here or anywhere else
 * in this step; that would be an admin capability, out of scope (see
 * `docs/08_Development_Roadmap.md`'s later "Admin, Security &
 * Reliability" phase).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
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

    const passwordHash = await this.passwordHasher.hash(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    return { email: user.email };
  }

  private staleSessionError(): UnauthorizedException {
    return new UnauthorizedException({
      code: "UNAUTHORIZED",
      message: "A valid access token is required.",
    });
  }
}
