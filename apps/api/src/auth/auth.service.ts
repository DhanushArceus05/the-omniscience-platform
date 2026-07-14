import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type { RegisterResponse, ResendOtpResponse, VerifyOtpResponse } from "@omniscience/types";
import type { Logger } from "pino";
import { ENV, LOGGER } from "../config/config.constants";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { OtpService } from "./otp.service";
import { PasswordHasherService } from "./password-hasher.service";
import {
  PendingRegistrationStore,
  type ClaimSendResult,
  type PendingRegistrationRecord,
  type RecordFailedAttemptResult,
} from "./pending-registration.store";

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

/** Prisma's unique-constraint violation error code. */
const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = "P2002";

/**
 * Orchestrates the approved authentication foundation flow:
 * email/password registration → pending registration (Redis) → 6-digit
 * OTP email → verification → real `User` row created in Postgres only
 * once verified.
 *
 * Deliberately does NOT issue any JWT/session here — that's Step 4
 * (login). A verified registration currently just means the account now
 * exists; the person still has to log in afterward.
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
