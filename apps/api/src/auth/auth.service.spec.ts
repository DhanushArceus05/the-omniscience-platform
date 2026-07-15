import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type { Logger } from "pino";
import { AccessTokenService } from "./access-token.service";
import { AuthService, type PendingRegistrationRecord } from "./auth.service";
import { OtpService } from "./otp.service";
import { PasswordHasherService } from "./password-hasher.service";
import { PasswordResetStore, type PasswordResetRecord } from "./password-reset.store";
import { PendingRegistrationStore } from "./pending-registration.store";
import { RefreshTokenStore } from "./refresh-token.store";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";

describe("AuthService", () => {
  const env = {
    OTP_TTL_SECONDS: 600,
    OTP_MAX_ATTEMPTS: 5,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
  } as unknown as Env;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;

  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  } as unknown as PrismaService;

  const passwordHasher = {
    hash: jest.fn(),
    verify: jest.fn(),
  } as unknown as PasswordHasherService;

  const otpService = { generateCode: jest.fn() } as unknown as OtpService;

  const pendingRegistrations = {
    get: jest.fn(),
    claimSend: jest.fn(),
    recordFailedAttempt: jest.fn(),
    delete: jest.fn(),
  } as unknown as PendingRegistrationStore;

  const mail = { sendMail: jest.fn(), isConfigured: () => false } as unknown as MailService;

  const accessTokens = {
    sign: jest.fn(),
    verify: jest.fn(),
    expiresInSeconds: 900,
  } as unknown as AccessTokenService;

  const refreshTokens = {
    issue: jest.fn(),
    consume: jest.fn(),
    revoke: jest.fn(),
  } as unknown as RefreshTokenStore;

  const passwordResets = {
    get: jest.fn(),
    claimSend: jest.fn(),
    recordFailedAttempt: jest.fn(),
    delete: jest.fn(),
  } as unknown as PasswordResetStore;

  const buildResetRecord = (overrides: Partial<PasswordResetRecord> = {}): PasswordResetRecord => ({
    userId: "user_1",
    otpHash: "hashed-reset-otp",
    otpAttempts: 0,
    otpExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    lastOtpSentAt: new Date(Date.now() - 120_000).toISOString(),
    ...overrides,
  });

  const buildRecord = (overrides: Partial<PendingRegistrationRecord> = {}): PendingRegistrationRecord => ({
    name: "Arceus",
    passwordHash: "hashed-password",
    otpHash: "hashed-otp",
    otpAttempts: 0,
    otpExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    lastOtpSentAt: new Date(Date.now() - 120_000).toISOString(),
    ...overrides,
  });

  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    id: "user_1",
    email: "user@example.com",
    passwordHash: "hashed-password",
    name: "Arceus",
    emailVerifiedAt: new Date(),
    ...overrides,
  });

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    (pendingRegistrations.claimSend as jest.Mock).mockResolvedValue({ status: "OK" });
    (passwordResets.claimSend as jest.Mock).mockResolvedValue({ status: "OK" });
    service = new AuthService(
      env,
      logger,
      prisma,
      passwordHasher,
      otpService,
      pendingRegistrations,
      mail,
      accessTokens,
      refreshTokens,
      passwordResets,
    );
  });

  describe("register", () => {
    it("claims the send and creates a pending registration for a new email", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (passwordHasher.hash as jest.Mock).mockResolvedValueOnce("hashed-password");
      (otpService.generateCode as jest.Mock).mockReturnValue("123456");
      (passwordHasher.hash as jest.Mock).mockResolvedValueOnce("hashed-otp");

      const result = await service.register({
        email: "user@example.com",
        password: "Sup3r$ecretPassw0rd!",
        name: "Arceus",
      });

      expect(pendingRegistrations.claimSend).toHaveBeenCalledWith(
        "user@example.com",
        expect.objectContaining({
          name: "Arceus",
          passwordHash: "hashed-password",
          otpHash: "hashed-otp",
          otpAttempts: 0,
        }),
      );
      expect(mail.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "user@example.com", text: expect.stringContaining("123456") }),
      );
      expect(result).toEqual({ email: "user@example.com", otpExpiresInSeconds: 600 });
    });

    it("throws ConflictException when a verified user already exists", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user_1" });

      await expect(
        service.register({ email: "user@example.com", password: "Sup3r$ecretPassw0rd!", name: "Arceus" }),
      ).rejects.toThrow(ConflictException);
      expect(pendingRegistrations.claimSend).not.toHaveBeenCalled();
    });

    it("throws a 429 and never sends an email when claimSend reports a cooldown", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (pendingRegistrations.claimSend as jest.Mock).mockResolvedValue({
        status: "COOLDOWN",
        retryAfterSeconds: 42,
      });

      await expect(
        service.register({ email: "user@example.com", password: "Sup3r$ecretPassw0rd!", name: "Arceus" }),
      ).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
        response: expect.objectContaining({ details: { retryAfterSeconds: 42 } }),
      });
      expect(mail.sendMail).not.toHaveBeenCalled();
    });
  });

  describe("verifyOtp", () => {
    it("creates the user and clears the pending registration on a correct code", async () => {
      const record = buildRecord();
      (pendingRegistrations.get as jest.Mock).mockResolvedValue(record);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: "user_1",
        email: "user@example.com",
      });

      const result = await service.verifyOtp("user@example.com", "123456");

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: "user@example.com",
          passwordHash: record.passwordHash,
          name: record.name,
          emailVerifiedAt: expect.any(Date),
        },
      });
      expect(pendingRegistrations.delete).toHaveBeenCalledWith("user@example.com");
      expect(result).toEqual({ userId: "user_1", email: "user@example.com" });
      expect(pendingRegistrations.recordFailedAttempt).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when there is no pending registration", async () => {
      (pendingRegistrations.get as jest.Mock).mockResolvedValue(null);

      await expect(service.verifyOtp("user@example.com", "123456")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("delegates the failed attempt atomically and throws BadRequestException on an incorrect code", async () => {
      const record = buildRecord({ otpAttempts: 1 });
      (pendingRegistrations.get as jest.Mock).mockResolvedValue(record);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(false);
      (pendingRegistrations.recordFailedAttempt as jest.Mock).mockResolvedValue({
        status: "INCREMENTED",
        attemptsRemaining: 3,
      });

      const promise = service.verifyOtp("user@example.com", "000000");
      await expect(promise).rejects.toThrow(BadRequestException);
      await expect(promise).rejects.toMatchObject({
        response: expect.objectContaining({ details: { attemptsRemaining: 3 } }),
      });
      expect(pendingRegistrations.recordFailedAttempt).toHaveBeenCalledWith("user@example.com");
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("throws GoneException when the atomic increment reports max attempts exceeded", async () => {
      const record = buildRecord({ otpAttempts: 4 });
      (pendingRegistrations.get as jest.Mock).mockResolvedValue(record);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(false);
      (pendingRegistrations.recordFailedAttempt as jest.Mock).mockResolvedValue({
        status: "MAX_ATTEMPTS_EXCEEDED",
      });

      await expect(service.verifyOtp("user@example.com", "000000")).rejects.toThrow(
        GoneException,
      );
    });

    it("deletes the pending registration and throws GoneException once max attempts are reached", async () => {
      const record = buildRecord({ otpAttempts: 5 });
      (pendingRegistrations.get as jest.Mock).mockResolvedValue(record);

      await expect(service.verifyOtp("user@example.com", "123456")).rejects.toThrow(
        GoneException,
      );
      expect(pendingRegistrations.delete).toHaveBeenCalledWith("user@example.com");
      expect(passwordHasher.verify).not.toHaveBeenCalled();
    });

    it("deletes the pending registration and throws GoneException when the OTP has expired", async () => {
      const record = buildRecord({ otpExpiresAt: new Date(Date.now() - 1000).toISOString() });
      (pendingRegistrations.get as jest.Mock).mockResolvedValue(record);

      await expect(service.verifyOtp("user@example.com", "123456")).rejects.toThrow(
        GoneException,
      );
      expect(pendingRegistrations.delete).toHaveBeenCalledWith("user@example.com");
      expect(passwordHasher.verify).not.toHaveBeenCalled();
    });

    it("converts a Prisma unique-constraint race into ConflictException", async () => {
      const record = buildRecord();
      (pendingRegistrations.get as jest.Mock).mockResolvedValue(record);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);
      const prismaError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      (prisma.user.create as jest.Mock).mockRejectedValue(prismaError);

      await expect(service.verifyOtp("user@example.com", "123456")).rejects.toThrow(
        ConflictException,
      );
      expect(pendingRegistrations.delete).toHaveBeenCalledWith("user@example.com");
    });
  });

  describe("resendOtp", () => {
    it("claims the send, issues a new OTP, resets attempts, and re-sends the email", async () => {
      const record = buildRecord({ otpAttempts: 3, lastOtpSentAt: new Date(Date.now() - 120_000).toISOString() });
      (pendingRegistrations.get as jest.Mock).mockResolvedValue(record);
      (otpService.generateCode as jest.Mock).mockReturnValue("654321");
      (passwordHasher.hash as jest.Mock).mockResolvedValue("new-hashed-otp");

      const result = await service.resendOtp("user@example.com");

      expect(pendingRegistrations.claimSend).toHaveBeenCalledWith(
        "user@example.com",
        expect.objectContaining({ otpAttempts: 0, otpHash: "new-hashed-otp" }),
      );
      expect(mail.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("654321") }),
      );
      expect(result).toEqual({ email: "user@example.com", otpExpiresInSeconds: 600 });
    });

    it("throws NotFoundException when there is no pending registration", async () => {
      (pendingRegistrations.get as jest.Mock).mockResolvedValue(null);

      await expect(service.resendOtp("user@example.com")).rejects.toThrow(NotFoundException);
    });

    it("throws a 429 and never sends an email when claimSend reports a cooldown", async () => {
      const record = buildRecord({ lastOtpSentAt: new Date().toISOString() });
      (pendingRegistrations.get as jest.Mock).mockResolvedValue(record);
      (pendingRegistrations.claimSend as jest.Mock).mockResolvedValue({
        status: "COOLDOWN",
        retryAfterSeconds: 17,
      });

      const promise = service.resendOtp("user@example.com");
      await expect(promise).rejects.toBeInstanceOf(HttpException);
      await expect(promise).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
      expect(mail.sendMail).not.toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("issues an access token and a refresh token for a verified user with the correct password", async () => {
      const user = buildUser();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);
      (accessTokens.sign as jest.Mock).mockResolvedValue("signed.jwt.token");
      (refreshTokens.issue as jest.Mock).mockResolvedValue({
        token: "token-id.secret",
        expiresInSeconds: 604800,
      });

      const result = await service.login("user@example.com", "correct-password");

      expect(passwordHasher.verify).toHaveBeenCalledWith(user.passwordHash, "correct-password");
      expect(accessTokens.sign).toHaveBeenCalledWith({ sub: user.id, email: user.email });
      expect(refreshTokens.issue).toHaveBeenCalledWith(user.id);
      expect(result).toEqual({
        accessToken: "signed.jwt.token",
        accessTokenExpiresInSeconds: 900,
        refreshToken: "token-id.secret",
        refreshTokenExpiresInSeconds: 604800,
        user: { id: user.id, email: user.email, name: user.name },
      });
    });

    it("throws UnauthorizedException for an unknown email, still calling verify against a dummy hash", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.login("nobody@example.com", "whatever")).rejects.toThrow(
        UnauthorizedException,
      );
      // Verify is still called (against a dummy hash) so a nonexistent
      // account doesn't respond measurably faster than a wrong password.
      expect(passwordHasher.verify).toHaveBeenCalledWith(expect.any(String), "whatever");
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it("throws UnauthorizedException for a wrong password", async () => {
      const user = buildUser();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.login("user@example.com", "wrong-password")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it("throws ForbiddenException when the account's email isn't verified yet", async () => {
      const user = buildUser({ emailVerifiedAt: null });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);

      await expect(service.login("user@example.com", "correct-password")).rejects.toThrow(
        ForbiddenException,
      );
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });
  });

  describe("refresh", () => {
    it("rotates the refresh token and issues a new access token", async () => {
      (refreshTokens.consume as jest.Mock).mockResolvedValue({ status: "OK", userId: "user_1" });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
      (accessTokens.sign as jest.Mock).mockResolvedValue("new.jwt.token");
      (refreshTokens.issue as jest.Mock).mockResolvedValue({
        token: "new-token-id.new-secret",
        expiresInSeconds: 604800,
      });

      const result = await service.refresh("old-token-id.old-secret");

      expect(refreshTokens.consume).toHaveBeenCalledWith("old-token-id.old-secret");
      expect(refreshTokens.issue).toHaveBeenCalledWith("user_1");
      expect(result).toEqual({
        accessToken: "new.jwt.token",
        accessTokenExpiresInSeconds: 900,
        refreshToken: "new-token-id.new-secret",
        refreshTokenExpiresInSeconds: 604800,
      });
    });

    it("throws UnauthorizedException when the token is unknown, already used, or expired", async () => {
      (refreshTokens.consume as jest.Mock).mockResolvedValue({ status: "NOT_FOUND" });

      await expect(service.refresh("bogus-token")).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it("throws UnauthorizedException when the token's user no longer exists", async () => {
      (refreshTokens.consume as jest.Mock).mockResolvedValue({ status: "OK", userId: "user_1" });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.refresh("token-id.secret")).rejects.toThrow(UnauthorizedException);
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("revokes the refresh token and always reports success", async () => {
      const result = await service.logout("token-id.secret");

      expect(refreshTokens.revoke).toHaveBeenCalledWith("token-id.secret");
      expect(result).toEqual({ loggedOut: true });
    });
  });

  describe("getCurrentUser", () => {
    it("returns the user's public identity", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());

      const result = await service.getCurrentUser("user_1");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: "user_1" } });
      expect(result).toEqual({ id: "user_1", email: "user@example.com", name: "Arceus" });
    });

    it("throws UnauthorizedException when the user no longer exists", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getCurrentUser("user_1")).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("forgotPassword", () => {
    it("claims the send and emails an OTP for an existing, verified account", async () => {
      const user = buildUser();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
      (otpService.generateCode as jest.Mock).mockReturnValue("654321");
      (passwordHasher.hash as jest.Mock).mockResolvedValue("hashed-reset-otp");

      const result = await service.forgotPassword("user@example.com");

      expect(passwordResets.claimSend).toHaveBeenCalledWith(
        "user@example.com",
        expect.objectContaining({ userId: user.id, otpAttempts: 0, otpHash: "hashed-reset-otp" }),
      );
      expect(mail.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "user@example.com", text: expect.stringContaining("654321") }),
      );
      expect(result).toEqual({ email: "user@example.com", otpExpiresInSeconds: 600 });
    });

    it("returns the same generic response and sends nothing for an unknown email", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.forgotPassword("nobody@example.com");

      expect(passwordResets.claimSend).not.toHaveBeenCalled();
      expect(mail.sendMail).not.toHaveBeenCalled();
      expect(result).toEqual({ email: "nobody@example.com", otpExpiresInSeconds: 600 });
    });

    it("returns the same generic response and sends nothing for an unverified account", async () => {
      const user = buildUser({ emailVerifiedAt: null });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);

      const result = await service.forgotPassword("user@example.com");

      expect(passwordResets.claimSend).not.toHaveBeenCalled();
      expect(mail.sendMail).not.toHaveBeenCalled();
      expect(result).toEqual({ email: "user@example.com", otpExpiresInSeconds: 600 });
    });

    it("silently respects the resend cooldown instead of throwing or leaking a 429", async () => {
      const user = buildUser();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
      (passwordResets.claimSend as jest.Mock).mockResolvedValue({
        status: "COOLDOWN",
        retryAfterSeconds: 42,
      });

      const result = await service.forgotPassword("user@example.com");

      expect(mail.sendMail).not.toHaveBeenCalled();
      expect(result).toEqual({ email: "user@example.com", otpExpiresInSeconds: 600 });
    });
  });

  describe("resetPassword", () => {
    it("verifies the code, updates the password hash, and clears the reset record", async () => {
      const record = buildResetRecord();
      (passwordResets.get as jest.Mock).mockResolvedValue(record);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser({ id: "user_1" }));
      (passwordHasher.hash as jest.Mock).mockResolvedValue("new-hashed-password");

      const result = await service.resetPassword("user@example.com", "123456", "N3wSup3r$ecret!");

      expect(passwordHasher.verify).toHaveBeenCalledWith(record.otpHash, "123456");
      expect(passwordHasher.hash).toHaveBeenCalledWith("N3wSup3r$ecret!");
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user_1" },
        data: { passwordHash: "new-hashed-password" },
      });
      expect(passwordResets.delete).toHaveBeenCalledWith("user@example.com");
      expect(result).toEqual({ email: "user@example.com" });
    });

    it("throws NotFoundException when there is no pending reset", async () => {
      (passwordResets.get as jest.Mock).mockResolvedValue(null);

      await expect(
        service.resetPassword("user@example.com", "123456", "N3wSup3r$ecret!"),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("deletes the reset record and throws GoneException once max attempts are reached", async () => {
      const record = buildResetRecord({ otpAttempts: 5 });
      (passwordResets.get as jest.Mock).mockResolvedValue(record);

      await expect(
        service.resetPassword("user@example.com", "000000", "N3wSup3r$ecret!"),
      ).rejects.toThrow(GoneException);
      expect(passwordResets.delete).toHaveBeenCalledWith("user@example.com");
      expect(passwordHasher.verify).not.toHaveBeenCalled();
    });

    it("deletes the reset record and throws GoneException when the OTP has expired", async () => {
      const record = buildResetRecord({ otpExpiresAt: new Date(Date.now() - 1000).toISOString() });
      (passwordResets.get as jest.Mock).mockResolvedValue(record);

      await expect(
        service.resetPassword("user@example.com", "123456", "N3wSup3r$ecret!"),
      ).rejects.toThrow(GoneException);
      expect(passwordResets.delete).toHaveBeenCalledWith("user@example.com");
      expect(passwordHasher.verify).not.toHaveBeenCalled();
    });

    it("delegates the failed attempt atomically and throws BadRequestException on an incorrect code", async () => {
      const record = buildResetRecord({ otpAttempts: 1 });
      (passwordResets.get as jest.Mock).mockResolvedValue(record);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(false);
      (passwordResets.recordFailedAttempt as jest.Mock).mockResolvedValue({
        status: "INCREMENTED",
        attemptsRemaining: 3,
      });

      const promise = service.resetPassword("user@example.com", "000000", "N3wSup3r$ecret!");
      await expect(promise).rejects.toThrow(BadRequestException);
      await expect(promise).rejects.toMatchObject({
        response: expect.objectContaining({ details: { attemptsRemaining: 3 } }),
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when the reset record's user no longer exists", async () => {
      const record = buildResetRecord();
      (passwordResets.get as jest.Mock).mockResolvedValue(record);
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.resetPassword("user@example.com", "123456", "N3wSup3r$ecret!"),
      ).rejects.toThrow(NotFoundException);
      expect(passwordResets.delete).toHaveBeenCalledWith("user@example.com");
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
