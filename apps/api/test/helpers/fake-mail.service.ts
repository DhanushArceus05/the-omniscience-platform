import type { SendMailInput } from "../../src/mail/mail.service";

/**
 * Shared, in-memory stand-in for `MailService` used across every e2e
 * spec — captures every "sent" email so a test can read the real
 * generated OTP out of the (never-logged-in-plaintext-elsewhere) email
 * body, exactly as a person would read it from their inbox.
 */
export class FakeMailService {
  sentEmails: SendMailInput[] = [];

  async sendMail(input: SendMailInput): Promise<void> {
    this.sentEmails.push(input);
  }

  isConfigured(): boolean {
    return false;
  }
}
