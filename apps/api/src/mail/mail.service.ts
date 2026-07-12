import { Inject, Injectable } from "@nestjs/common";
import { isSmtpConfigured, type Env } from "@omniscience/config";
import type { Logger } from "pino";
import nodemailer, { type Transporter } from "nodemailer";
import { ENV, LOGGER } from "../config/config.constants";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Generic transactional-mail sender.
 *
 * Production: uses SMTP via nodemailer once every `SMTP_*` variable is
 * set (validated as all-or-nothing in `packages/config`).
 *
 * Development / unconfigured: instead of throwing (which would block
 * registration/password-reset entirely in local dev), the message is
 * logged through the shared structured logger at `warn` level so it's
 * impossible to miss, and clearly marked as a fallback — never a fake or
 * hardcoded OTP, just the real generated message that would have been
 * emailed. This fallback is intentional per the approved Phase 2
 * decisions and applies regardless of `NODE_ENV`; operators who deploy to
 * production without configuring SMTP are still responsible for that
 * choice, but the app never fails a request silently either way.
 *
 * No OTP-specific templates live here — this service only knows how to
 * send an already-composed message. Step 3 builds the OTP email content
 * on top of this.
 */
@Injectable()
export class MailService {
  private readonly transporter: Transporter | null;
  private readonly configured: boolean;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.configured = isSmtpConfigured(env);
    this.transporter = this.configured
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
        })
      : null;

    if (!this.configured) {
      this.logger.warn(
        "SMTP is not configured (SMTP_HOST unset) — emails will be logged to the console instead of sent",
      );
    }
  }

  async sendMail(input: SendMailInput): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(
        { to: input.to, subject: input.subject, body: input.text },
        "SMTP not configured — logging email instead of sending (development fallback)",
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    this.logger.info({ to: input.to, subject: input.subject }, "email sent");
  }

  isConfigured(): boolean {
    return this.configured;
  }
}
