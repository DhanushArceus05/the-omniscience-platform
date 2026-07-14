import { OtpService } from "./otp.service";

describe("OtpService", () => {
  const service = new OtpService();

  it("generates a 6-digit numeric string", () => {
    const code = service.generateCode();

    expect(code).toMatch(/^\d{6}$/);
  });

  it("zero-pads codes below 100000", () => {
    // Statistically, at least one of many generated codes should start
    // with a zero if padding works; this asserts the *format* invariant
    // rather than relying on a specific draw.
    const codes = Array.from({ length: 200 }, () => service.generateCode());

    expect(codes.every((code) => code.length === 6)).toBe(true);
  });

  it("is not hardcoded — repeated calls produce varying codes", () => {
    const codes = new Set(Array.from({ length: 50 }, () => service.generateCode()));

    // 50 draws from a 1,000,000-value space being all identical would
    // indicate a fake/hardcoded generator, not real randomness.
    expect(codes.size).toBeGreaterThan(1);
  });
});
