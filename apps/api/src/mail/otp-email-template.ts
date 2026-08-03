/**
 * Renders the HTML body for a transactional OTP email (registration
 * verification or password reset) — sent alongside the existing plain
 * `text` body (see `AuthService.sendOtpEmail`/`sendPasswordResetOtpEmail`),
 * never replacing it: `MailService.sendMail` forwards both to
 * `nodemailer`, which sends a proper `multipart/alternative` message so
 * every email client picks whichever it can render, and the
 * console-logging development fallback still has the plain `text` body
 * to print.
 *
 * Deliberately table-based layout with every style inlined, no
 * `<style>` block, no external stylesheet, font, or image reference —
 * the standard constraints for HTML email specifically (most webmail
 * clients strip `<style>` blocks and `<head>` content, and an external
 * asset either gets blocked by default or becomes a tracking-pixel-like
 * privacy concern for a security-sensitive email). `escapeHtml` is
 * applied to every interpolated value even though today's callers only
 * ever pass a fixed-format 6-digit code and a plain-language heading —
 * defense-in-depth against a future caller passing anything else
 * through unescaped.
 */
export interface OtpEmailContent {
  readonly heading: string;
  readonly bodyText: string;
  readonly code: string;
  readonly footerNote: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderOtpEmailHtml(content: OtpEmailContent): string {
  const heading = escapeHtml(content.heading);
  const bodyText = escapeHtml(content.bodyText);
  const code = escapeHtml(content.code);
  const footerNote = escapeHtml(content.footerNote);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#06060a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#06060a;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#0b0b12;border:1px solid rgba(255,255,255,0.08);border-radius:16px;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#a4a4b3;">The Omniscience Platform</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;color:#f4f4f6;">${heading}</h1>
                <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#a4a4b3;">${bodyText}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#101018;border:1px solid rgba(255,255,255,0.12);border-radius:12px;">
                  <tr>
                    <td align="center" style="padding:20px;">
                      <span style="font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:0.35em;color:#f4f4f6;">${code}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6b6b7b;">${footerNote}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
