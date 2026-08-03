import { renderOtpEmailHtml } from "./otp-email-template";

describe("renderOtpEmailHtml", () => {
  it("includes the code, heading, body text, and footer note", () => {
    const html = renderOtpEmailHtml({
      heading: "Verify your email",
      bodyText: "Enter this code to finish setting up your account. It expires in 10 minutes.",
      code: "123456",
      footerNote: "If you didn't request this, you can safely ignore this email.",
    });

    expect(html).toContain("123456");
    expect(html).toContain("Verify your email");
    expect(html).toContain("Enter this code to finish setting up your account. It expires in 10 minutes.");
    expect(html).toContain("If you didn&#39;t request this, you can safely ignore this email.");
  });

  it("escapes HTML-significant characters in every interpolated field", () => {
    const html = renderOtpEmailHtml({
      heading: "<script>alert(1)</script>",
      bodyText: "<img src=x onerror=alert(1)>",
      code: "123456",
      footerNote: "\"quoted\" & <b>bold</b>",
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;");
  });

  it("produces a valid HTML document with no external stylesheet/font/image references", () => {
    const html = renderOtpEmailHtml({
      heading: "Verify your email",
      bodyText: "body",
      code: "000000",
      footerNote: "footer",
    });

    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/<img\s/i);
    expect(html).not.toMatch(/https?:\/\//i);
  });
});
