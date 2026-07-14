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
 * Production: SMTP is mandatory — `packages/config`'s environment
 * validation already fails startup if any `SMTP_*` variable is unset in
 * production, so `this.transporter` is guaranteed to be set here. The
 * `!this.transporter` branch below is defense-in-depth only: if it is
 * ever somehow reached in production, this service fails loudly instead
 * of logging a plaintext OTP/email body.
 *
 * Development / test: if SMTP is unconfigured, the message is logged
 * through the shared structured logger at `warn` level instead of being
 * sent, so it's impossible to miss and a developer can read the real OTP
 * without a working SMTP server. This fallback is intentionally disabled
 * outside development/test — see the Phase 2 Step 3 blocker fix in
 * `claude/CURRENT_PHASE.md`.
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
      if (this.env.NODE_ENV === "production") {
        // Unreachable in practice: environment validation already requires
        // SMTP_* in production. Kept as a hard failure (never a plaintext
        // log) in case that invariant is ever broken by a future change.
        this.logger.error(
          { to: input.to, subject: input.subject },
          "refusing to send: SMTP is not configured in production",
        );
        throw new Error(
          "MailService: SMTP is not configured. Emails cannot be sent in production.",
        );
      }

      this.logger.warn(
        { to: input.to, subject: input.subject, body: input.text },
        "SMTP not configured — logging email instead of sending (development/test fallback)",
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
