import { ConflictException, GoneException, HttpException, HttpStatus, NotFoundException, BadRequestException } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type { Logger } from "pino";
import { AuthService, type PendingRegistrationRecord } from "./auth.service";
import { OtpService } from "./otp.service";
import { PasswordHasherService } from "./password-hasher.service";
import { PendingRegistrationStore } from "./pending-registration.store";
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
    user: { findUnique: jest.fn(), create: jest.fn() },
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

  let service: AuthService;

  const buildRecord = (overrides: Partial<PendingRegistrationRecord> = {}): PendingRegistrationRecord => ({
    name: "Arceus",
    passwordHash: "hashed-password",
    otpHash: "hashed-otp",
    otpAttempts: 0,
    otpExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    lastOtpSentAt: new Date(Date.now() - 120_000).toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (pendingRegistrations.claimSend as jest.Mock).mockResolvedValue({ status: "OK" });
    service = new AuthService(env, logger, prisma, passwordHasher, otpService, pendingRegistrations, mail);
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
});
