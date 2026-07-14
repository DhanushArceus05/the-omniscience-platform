import { Test, TestingModule } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import type { Logger } from "pino";
import { ENV, LOGGER } from "../config/config.constants";
import { MailService } from "./mail.service";

const sendMail = jest.fn();
const createTransport = jest.fn((..._args: unknown[]) => ({ sendMail }));

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: (...args: unknown[]) => createTransport(...args) },
  createTransport: (...args: unknown[]) => createTransport(...args),
}));

function makeLogger(): Logger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;
}

async function build(env: Partial<Env>, logger: Logger): Promise<MailService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MailService,
      { provide: ENV, useValue: env as Env },
      { provide: LOGGER, useValue: logger },
    ],
  }).compile();

  return module.get<MailService>(MailService);
}

describe("MailService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("when SMTP is not configured", () => {
    it("reports isConfigured() as false and warns once on construction", async () => {
      const logger = makeLogger();
      const service = await build({ SMTP_HOST: undefined } as Partial<Env>, logger);

      expect(service.isConfigured()).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("SMTP is not configured"),
      );
    });

    it("logs the message instead of sending, and never throws", async () => {
      const logger = makeLogger();
      const service = await build(
        { SMTP_HOST: undefined, NODE_ENV: "development" } as Partial<Env>,
        logger,
      );

      await expect(
        service.sendMail({ to: "user@example.com", subject: "Your OTP", text: "123456" }),
      ).resolves.toBeUndefined();

      expect(sendMail).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ to: "user@example.com", subject: "Your OTP", body: "123456" }),
        expect.stringContaining("development/test fallback"),
      );
    });
  });

  describe("when SMTP is not configured in production", () => {
    it("refuses to send and never logs the plaintext body or OTP", async () => {
      const warn = jest.fn();
      const error = jest.fn();
      const logger = { info: jest.fn(), warn, error } as unknown as Logger;
      const service = await build(
        { SMTP_HOST: undefined, NODE_ENV: "production" } as Partial<Env>,
        logger,
      );

      await expect(
        service.sendMail({ to: "user@example.com", subject: "Your OTP", text: "654321" }),
      ).rejects.toThrow(/SMTP is not configured/);

      expect(sendMail).not.toHaveBeenCalled();

      // Assert across every logger call (warn from the constructor, error
      // from sendMail) that the plaintext OTP never appears anywhere.
      const allLoggedArgs = [...warn.mock.calls, ...error.mock.calls].flat();
      expect(JSON.stringify(allLoggedArgs)).not.toContain("654321");
    });
  });

  describe("when SMTP is fully configured", () => {
    const smtpEnv: Partial<Env> = {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: 587,
      SMTP_USER: "user",
      SMTP_PASSWORD: "pass",
      SMTP_FROM: "noreply@example.com",
      SMTP_SECURE: false,
    };

    it("reports isConfigured() as true", async () => {
      const service = await build(smtpEnv, makeLogger());
      expect(service.isConfigured()).toBe(true);
    });

    it("sends via the nodemailer transport instead of logging", async () => {
      const logger = makeLogger();
      const service = await build(smtpEnv, logger);

      await service.sendMail({ to: "user@example.com", subject: "Your OTP", text: "123456" });

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "noreply@example.com",
          to: "user@example.com",
          subject: "Your OTP",
          text: "123456",
        }),
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
