import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type {
  ForgotPasswordResponse,
  LoginResponse,
  LogoutResponse,
  MeResponse,
  RefreshResponse,
  RegisterResponse,
  ResendOtpResponse,
  ResetPasswordResponse,
  VerifyOtpResponse,
} from "@omniscience/types";
import type { Logger } from "pino";
import { ENV, LOGGER } from "../config/config.constants";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { AccessTokenService } from "./access-token.service";
import { OtpService } from "./otp.service";
import { PasswordHasherService } from "./password-hasher.service";
import {
  PasswordResetStore,
  type RecordFailedAttemptResult as PasswordResetRecordFailedAttemptResult,
} from "./password-reset.store";
import {
  PendingRegistrationStore,
  type ClaimSendResult,
  type PendingRegistrationRecord,
  type RecordFailedAttemptResult,
} from "./pending-registration.store";
import { RefreshTokenStore } from "./refresh-token.store";

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

/** Prisma's unique-constraint violation error code. */
const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = "P2002";

/**
 * A syntactically valid Argon2id hash of an arbitrary, unrelated
 * password (never a real user's), generated once with the same
 * parameters `PasswordHasherService` uses. `login()` verifies against
 * this when no account exists for the given email, so the KDF still runs
 * either way — an account-not-found response and a wrong-password
 * response take roughly the same amount of time, which is what actually
 * prevents email enumeration via a timing side channel (returning the
 * same generic error message alone is not enough if one path is
 * measurably faster than the other).
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=3,p=1$y+ThfWzgfsiLEbHm3WSNgA$ObL+tfjlWhmE7vuv780S3rbATvnVTGZHmB+TGBqtGNw";

/**
 * Orchestrates the approved authentication foundation flow:
 * email/password registration → pending registration (Redis) → 6-digit
 * OTP email → verification → real `User` row created in Postgres only
 * once verified (Step 3); then login → JWT access token + Redis-backed
 * refresh token → refresh (rotates both) → logout (revokes the refresh
 * token) (Step 4); then forgot-password → 6-digit OTP email → reset
 * (verifies the OTP and overwrites `passwordHash`) (Step 5).
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly otpService: OtpService,
    private readonly pendingRegistrations: PendingRegistrationStore,
    private readonly mail: MailService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly passwordResets: PasswordResetStore,
  ) {}

  async register(input: RegisterInput): Promise<RegisterResponse> {
    const { email } = input;

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException({
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account with this email already exists.",
      });
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    const { otp, otpHash, otpExpiresAt, lastOtpSentAt } = await this.issueOtp();

    // Registering again for an email that already has a pending
    // registration is allowed (e.g. the person mistyped their password
    // and wants to retry) but still respects the resend cooldown, so
    // repeated /register calls can't be used to bypass /resend-otp's
    // rate limiting and spam an inbox. `claimSend` checks the cooldown
    // and writes the new pending record as a single atomic Redis
    // operation, so two concurrent /register calls for the same email
    // can never both win the claim and both send an email (Phase 2 Step
    // 3 blocker fix).
    const claim = await this.pendingRegistrations.claimSend(email, {
      name: input.name,
      passwordHash,
      otpHash,
      otpAttempts: 0,
      otpExpiresAt,
      lastOtpSentAt,
    });
    this.assertClaimed(claim);

    await this.sendOtpEmail(email, otp);

    this.logger.info({ email }, "registration started, otp sent");

    return { email, otpExpiresInSeconds: this.env.OTP_TTL_SECONDS };
  }

  async verifyOtp(email: string, otp: string): Promise<VerifyOtpResponse> {
    const record = await this.pendingRegistrations.get(email);
    if (!record) {
      throw new NotFoundException({
        code: "PENDING_REGISTRATION_NOT_FOUND",
        message:
          "No pending registration found for this email, or it has expired. Please register again.",
      });
    }

    if (record.otpAttempts >= this.env.OTP_MAX_ATTEMPTS) {
      await this.pendingRegistrations.delete(email);
      throw new GoneException({
        code: "OTP_MAX_ATTEMPTS_EXCEEDED",
        message: "Too many incorrect attempts. Please register again.",
      });
    }

    if (new Date(record.otpExpiresAt).getTime() < Date.now()) {
      await this.pendingRegistrations.delete(email);
      throw new GoneException({
        code: "OTP_EXPIRED",
        message: "This verification code has expired. Please request a new one.",
      });
    }

    const isValid = await this.passwordHasher.verify(record.otpHash, otp);
    if (!isValid) {
      // The attempt counter itself is never taken from this stale local
      // `record` read — it's recomputed atomically in Redis so two
      // concurrent wrong guesses can't lose an increment or bypass
      // `OTP_MAX_ATTEMPTS` (Phase 2 Step 3 blocker fix). AuthService only
      // consumes the atomic result below to decide which response to
      // return.
      const result = await this.pendingRegistrations.recordFailedAttempt(email);
      throw this.errorForFailedAttempt(result);
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: record.passwordHash,
          name: record.name,
          emailVerifiedAt: new Date(),
        },
      });

      await this.pendingRegistrations.delete(email);
      this.logger.info({ email, userId: user.id }, "registration completed (email verified)");

      return { userId: user.id, email: user.email };
    } catch (err) {
      if (this.isPrismaUniqueConstraintError(err)) {
        // Rare race: another request verified/created this email between
        // our earlier check and this create. Treat it the same as the
        // upfront duplicate-email check.
        await this.pendingRegistrations.delete(email);
        throw new ConflictException({
          code: "EMAIL_ALREADY_REGISTERED",
          message: "An account with this email already exists.",
        });
      }
      throw err;
    }
  }

  async resendOtp(email: string): Promise<ResendOtpResponse> {
    const record = await this.pendingRegistrations.get(email);
    if (!record) {
      throw new NotFoundException({
        code: "PENDING_REGISTRATION_NOT_FOUND",
        message: "No pending registration found for this email. Please register again.",
      });
    }

    const { otp, otpHash, otpExpiresAt, lastOtpSentAt } = await this.issueOtp();

    // Same atomic claim as `register` — two concurrent /resend-otp calls
    // for the same email can never both pass the cooldown and both issue
    // a fresh OTP email (Phase 2 Step 3 blocker fix).
    const claim = await this.pendingRegistrations.claimSend(email, {
      ...record,
      otpHash,
      otpAttempts: 0,
      otpExpiresAt,
      lastOtpSentAt,
    });
    this.assertClaimed(claim);

    await this.sendOtpEmail(email, otp);

    this.logger.info({ email }, "otp resent");

    return { email, otpExpiresInSeconds: this.env.OTP_TTL_SECONDS };
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Same generic error for "no such account" and "wrong password" —
    // distinguishing them would let a caller enumerate registered
    // emails. `passwordHasher.verify` is still called (against
    // `DUMMY_HASH` when there's no real user) in both branches so the
    // response time doesn't itself leak which case occurred.
    const isValid = await this.passwordHasher.verify(user?.passwordHash ?? DUMMY_HASH, password);
    if (!user || !isValid) {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Incorrect email or password.",
      });
    }

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email before signing in.",
      });
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.accessTokens.sign({ sub: user.id, email: user.email }),
      this.refreshTokens.issue(user.id),
    ]);

    this.logger.info({ userId: user.id }, "login succeeded");

    return {
      accessToken,
      accessTokenExpiresInSeconds: this.accessTokens.expiresInSeconds,
      refreshToken: refreshToken.token,
      refreshTokenExpiresInSeconds: refreshToken.expiresInSeconds,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  async refresh(refreshToken: string): Promise<RefreshResponse> {
    // `consume()` is single-use and atomic (Redis `GETDEL`): the
    // presented token can never be exchanged a second time, whether this
    // call succeeds or fails below — a stolen-then-replayed token, or two
    // concurrent refresh calls racing on the same token, can never both
    // produce a valid result.
    const result = await this.refreshTokens.consume(refreshToken);
    if (result.status === "NOT_FOUND") {
      throw new UnauthorizedException({
        code: "REFRESH_TOKEN_INVALID",
        message: "This session has expired or is no longer valid. Please sign in again.",
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: result.userId } });
    if (!user) {
      // The account was deleted after this refresh token was issued.
      throw new UnauthorizedException({
        code: "REFRESH_TOKEN_INVALID",
        message: "This session has expired or is no longer valid. Please sign in again.",
      });
    }

    const [accessToken, newRefreshToken] = await Promise.all([
      this.accessTokens.sign({ sub: user.id, email: user.email }),
      this.refreshTokens.issue(user.id),
    ]);

    return {
      accessToken,
      accessTokenExpiresInSeconds: this.accessTokens.expiresInSeconds,
      refreshToken: newRefreshToken.token,
      refreshTokenExpiresInSeconds: newRefreshToken.expiresInSeconds,
    };
  }

  async logout(refreshToken: string): Promise<LogoutResponse> {
    // Always succeeds — revoking an already-invalid token is a no-op
    // (see `RefreshTokenStore.revoke`), so logout never leaks whether the
    // token it was given was valid. The corresponding access token (if
    // any) simply expires naturally within `JWT_ACCESS_TTL_SECONDS`; it
    // isn't (and can't be, being stateless) revoked immediately — an
    // accepted tradeoff for a 15-minute-default access token, called out
    // in known limitations.
    await this.refreshTokens.revoke(refreshToken);
    return { loggedOut: true };
  }

  async getCurrentUser(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "A valid access token is required.",
      });
    }
    return { id: user.id, email: user.email, name: user.name };
  }

  /**
   * Starts a password reset for `email`.
   *
   * Always returns the same generic response, whether or not `email`
   * belongs to a real, verified account — the response itself must never
   * reveal account existence (a stricter guarantee than `login`'s, which
   * only matches response *content*; here the Redis write and OTP email
   * simply don't happen at all for an unknown or unverified email, so
   * there is nothing to observe from the response). The OTP is only ever
   * issued for an existing, verified `User` row — a merely-pending
   * registration (Step 3) has no `User` row yet and is treated the same
   * as an unregistered email.
   */
  async forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user && user.emailVerifiedAt) {
      const { otp, otpHash, otpExpiresAt, lastOtpSentAt } = await this.issueOtp();

      // Same atomic cooldown claim as registration's `claimSend` (Phase 2
      // Step 3 blocker fix pattern): two concurrent /forgot-password
      // calls for the same email can never both win the claim and both
      // send a reset OTP email. Unlike register/resend, a lost cooldown
      // race here must NOT be surfaced to the caller (see the doc
      // comment above) — it silently keeps whichever OTP is already
      // in flight rather than throwing a 429, so the response can stay
      // identical to the "no account" case.
      const claim = await this.passwordResets.claimSend(email, {
        userId: user.id,
        otpHash,
        otpAttempts: 0,
        otpExpiresAt,
        lastOtpSentAt,
      });

      if (claim.status === "OK") {
        await this.sendPasswordResetOtpEmail(email, otp);
        this.logger.info({ userId: user.id }, "password reset otp sent");
      } else {
        this.logger.info(
          { userId: user.id },
          "password reset otp not resent: resend cooldown still active",
        );
      }
    } else {
      this.logger.info({ email }, "forgot-password requested for unknown or unverified email");
    }

    return { email, otpExpiresInSeconds: this.env.OTP_TTL_SECONDS };
  }

  /**
   * Completes a password reset: verifies the OTP issued by
   * `forgotPassword` and, only on success, overwrites the user's
   * `passwordHash`.
   *
   * Deliberately does not revoke the user's existing refresh tokens —
   * `RefreshTokenStore` (Step 4) has no index from `userId` to its
   * issued tokens, only from an opaque `tokenId` the client already
   * holds, so there is nothing to look up and revoke here without adding
   * that index (out of scope for this step; see known limitations).
   */
  async resetPassword(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<ResetPasswordResponse> {
    const record = await this.passwordResets.get(email);
    if (!record) {
      throw new NotFoundException({
        code: "PASSWORD_RESET_NOT_FOUND",
        message: "No password reset was requested for this email, or it has expired.",
      });
    }

    if (record.otpAttempts >= this.env.OTP_MAX_ATTEMPTS) {
      await this.passwordResets.delete(email);
      throw new GoneException({
        code: "OTP_MAX_ATTEMPTS_EXCEEDED",
        message: "Too many incorrect attempts. Please request a new reset code.",
      });
    }

    if (new Date(record.otpExpiresAt).getTime() < Date.now()) {
      await this.passwordResets.delete(email);
      throw new GoneException({
        code: "OTP_EXPIRED",
        message: "This reset code has expired. Please request a new one.",
      });
    }

    const isValid = await this.passwordHasher.verify(record.otpHash, otp);
    if (!isValid) {
      // Same atomic counter as `verifyOtp` (Phase 2 Step 3 blocker fix):
      // recomputed in Redis so concurrent wrong guesses can't lose an
      // increment or bypass `OTP_MAX_ATTEMPTS`.
      const result = await this.passwordResets.recordFailedAttempt(email);
      throw this.errorForFailedPasswordResetAttempt(result);
    }

    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) {
      // The account was deleted after the reset OTP was issued.
      await this.passwordResets.delete(email);
      throw new NotFoundException({
        code: "PASSWORD_RESET_NOT_FOUND",
        message: "No password reset was requested for this email, or it has expired.",
      });
    }

    const passwordHash = await this.passwordHasher.hash(newPassword);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.passwordResets.delete(email);

    this.logger.info({ userId: user.id }, "password reset completed");

    return { email: user.email };
  }

  private async issueOtp(): Promise<{
    otp: string;
    otpHash: string;
    otpExpiresAt: string;
    lastOtpSentAt: string;
  }> {
    const otp = this.otpService.generateCode();
    const otpHash = await this.passwordHasher.hash(otp);
    const now = new Date();
    return {
      otp,
      otpHash,
      otpExpiresAt: new Date(now.getTime() + this.env.OTP_TTL_SECONDS * 1000).toISOString(),
      lastOtpSentAt: now.toISOString(),
    };
  }

  /** Throws the standard 429 when a `claimSend` call lost the cooldown race. */
  private assertClaimed(claim: ClaimSendResult): void {
    if (claim.status === "COOLDOWN") {
      throw new HttpException(
        {
          code: "OTP_RESEND_COOLDOWN",
          message: "Please wait before requesting another verification code.",
          details: { retryAfterSeconds: claim.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Maps the atomic `recordFailedAttempt` result to the response the API contract expects. */
  private errorForFailedAttempt(result: RecordFailedAttemptResult): HttpException {
    switch (result.status) {
      case "NOT_FOUND":
        return new NotFoundException({
          code: "PENDING_REGISTRATION_NOT_FOUND",
          message:
            "No pending registration found for this email, or it has expired. Please register again.",
        });
      case "EXPIRED":
        return new GoneException({
          code: "OTP_EXPIRED",
          message: "This verification code has expired. Please request a new one.",
        });
      case "MAX_ATTEMPTS_EXCEEDED":
        return new GoneException({
          code: "OTP_MAX_ATTEMPTS_EXCEEDED",
          message: "Too many incorrect attempts. Please register again.",
        });
      case "INCREMENTED":
        return new BadRequestException({
          code: "OTP_INCORRECT",
          message: "The verification code is incorrect.",
          details: { attemptsRemaining: result.attemptsRemaining },
        });
    }
  }

  private async sendOtpEmail(email: string, otp: string): Promise<void> {
    const minutes = Math.round(this.env.OTP_TTL_SECONDS / 60);
    await this.mail.sendMail({
      to: email,
      subject: "Your Omniscience Platform verification code",
      text: `Your verification code is ${otp}. It expires in ${minutes} minute${minutes === 1 ? "" : "s"}. If you didn't request this, you can safely ignore this email.`,
    });
  }

  /**
   * Maps the atomic `PasswordResetStore.recordFailedAttempt` result to the
   * response the API contract expects.
   */
  private errorForFailedPasswordResetAttempt(
    result: PasswordResetRecordFailedAttemptResult,
  ): HttpException {
    switch (result.status) {
      case "NOT_FOUND":
        return new NotFoundException({
          code: "PASSWORD_RESET_NOT_FOUND",
          message: "No password reset was requested for this email, or it has expired.",
        });
      case "EXPIRED":
        return new GoneException({
          code: "OTP_EXPIRED",
          message: "This reset code has expired. Please request a new one.",
        });
      case "MAX_ATTEMPTS_EXCEEDED":
        return new GoneException({
          code: "OTP_MAX_ATTEMPTS_EXCEEDED",
          message: "Too many incorrect attempts. Please request a new reset code.",
        });
      case "INCREMENTED":
        return new BadRequestException({
          code: "OTP_INCORRECT",
          message: "The reset code is incorrect.",
          details: { attemptsRemaining: result.attemptsRemaining },
        });
    }
  }

  private async sendPasswordResetOtpEmail(email: string, otp: string): Promise<void> {
    const minutes = Math.round(this.env.OTP_TTL_SECONDS / 60);
    await this.mail.sendMail({
      to: email,
      subject: "Your Omniscience Platform password reset code",
      text: `Your password reset code is ${otp}. It expires in ${minutes} minute${minutes === 1 ? "" : "s"}. If you didn't request this, you can safely ignore this email — your password has not been changed.`,
    });
  }

  private isPrismaUniqueConstraintError(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
    );
  }
}

// Re-exported for tests that need to construct a record shape directly.
export type { PendingRegistrationRecord };
