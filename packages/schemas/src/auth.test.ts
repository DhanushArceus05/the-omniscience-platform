import { describe, expect, it } from "vitest";
import {
  displayNameSchema,
  emailSchema,
  forgotPasswordRequestSchema,
  loginPasswordSchema,
  loginRequestSchema,
  logoutRequestSchema,
  otpCodeSchema,
  passwordSchema,
  refreshRequestSchema,
  refreshTokenSchema,
  registerRequestSchema,
  resendOtpRequestSchema,
  resetPasswordRequestSchema,
  verifyOtpRequestSchema,
} from "./auth";

describe("emailSchema", () => {
  it("accepts a valid email and normalizes case/whitespace", () => {
    expect(emailSchema.parse("  User@Example.com  ")).toBe("user@example.com");
  });

  it("rejects a malformed email", () => {
    expect(() => emailSchema.parse("not-an-email")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => emailSchema.parse("")).toThrow();
  });

  it("rejects an email longer than 254 characters", () => {
    const tooLong = `${"a".repeat(250)}@example.com`;
    expect(() => emailSchema.parse(tooLong)).toThrow();
  });
});

describe("passwordSchema", () => {
  const strong = "Sup3r$ecretPassw0rd!";

  it("accepts a password meeting every rule", () => {
    expect(passwordSchema.parse(strong)).toBe(strong);
  });

  it("rejects a password shorter than 10 characters", () => {
    expect(() => passwordSchema.parse("Sh0rt!")).toThrow();
  });

  it("rejects a password missing an uppercase letter", () => {
    expect(() => passwordSchema.parse("weak-password-1")).toThrow();
  });

  it("rejects a password missing a number", () => {
    expect(() => passwordSchema.parse("NoNumbersHere!")).toThrow();
  });

  it("rejects a password missing a special character", () => {
    expect(() => passwordSchema.parse("NoSpecialChar1")).toThrow();
  });

  it("rejects a purely numeric or common weak password", () => {
    expect(() => passwordSchema.parse("password1")).toThrow();
  });
});

describe("displayNameSchema", () => {
  it("accepts a valid name and trims whitespace", () => {
    expect(displayNameSchema.parse("  Arceus  ")).toBe("Arceus");
  });

  it("rejects a name shorter than 2 characters", () => {
    expect(() => displayNameSchema.parse("A")).toThrow();
  });

  it("rejects a name longer than 100 characters", () => {
    expect(() => displayNameSchema.parse("a".repeat(101))).toThrow();
  });
});

describe("otpCodeSchema", () => {
  it("accepts a 6-digit code and trims whitespace", () => {
    expect(otpCodeSchema.parse(" 123456 ")).toBe("123456");
  });

  it("rejects a code with fewer than 6 digits", () => {
    expect(() => otpCodeSchema.parse("12345")).toThrow();
  });

  it("rejects a code with non-digit characters", () => {
    expect(() => otpCodeSchema.parse("12345a")).toThrow();
  });
});

describe("registerRequestSchema", () => {
  const valid = { email: "User@Example.com", password: "Sup3r$ecretPassw0rd!", name: "Arceus" };

  it("accepts a valid payload and normalizes email", () => {
    expect(registerRequestSchema.parse(valid)).toEqual({
      ...valid,
      email: "user@example.com",
    });
  });

  it("rejects a payload with a weak password", () => {
    expect(() => registerRequestSchema.parse({ ...valid, password: "weak" })).toThrow();
  });
});

describe("verifyOtpRequestSchema", () => {
  it("accepts a valid payload", () => {
    expect(verifyOtpRequestSchema.parse({ email: "user@example.com", otp: "123456" })).toEqual({
      email: "user@example.com",
      otp: "123456",
    });
  });

  it("rejects a malformed otp", () => {
    expect(() =>
      verifyOtpRequestSchema.parse({ email: "user@example.com", otp: "abc" }),
    ).toThrow();
  });
});

describe("resendOtpRequestSchema", () => {
  it("accepts a valid payload", () => {
    expect(resendOtpRequestSchema.parse({ email: "user@example.com" })).toEqual({
      email: "user@example.com",
    });
  });

  it("rejects a missing email", () => {
    expect(() => resendOtpRequestSchema.parse({})).toThrow();
  });
});

describe("loginPasswordSchema", () => {
  it("accepts a password that would fail the strong-password policy", () => {
    // Login must never lock out an account created under an older/looser
    // policy, so it only requires a non-empty string.
    expect(loginPasswordSchema.parse("weak")).toBe("weak");
  });

  it("rejects an empty password", () => {
    expect(() => loginPasswordSchema.parse("")).toThrow();
  });

  it("rejects a password longer than 128 characters", () => {
    expect(() => loginPasswordSchema.parse("a".repeat(129))).toThrow();
  });
});

describe("loginRequestSchema", () => {
  it("accepts a valid payload and normalizes email", () => {
    expect(loginRequestSchema.parse({ email: "User@Example.com", password: "anything" })).toEqual(
      { email: "user@example.com", password: "anything" },
    );
  });

  it("rejects a missing password", () => {
    expect(() => loginRequestSchema.parse({ email: "user@example.com" })).toThrow();
  });
});

describe("refreshTokenSchema", () => {
  it("accepts a non-empty token", () => {
    expect(refreshTokenSchema.parse("abc.def")).toBe("abc.def");
  });

  it("rejects an empty token", () => {
    expect(() => refreshTokenSchema.parse("")).toThrow();
  });
});

describe("refreshRequestSchema", () => {
  it("accepts a valid payload", () => {
    expect(refreshRequestSchema.parse({ refreshToken: "abc.def" })).toEqual({
      refreshToken: "abc.def",
    });
  });

  it("rejects a missing refreshToken", () => {
    expect(() => refreshRequestSchema.parse({})).toThrow();
  });
});

describe("logoutRequestSchema", () => {
  it("accepts a valid payload", () => {
    expect(logoutRequestSchema.parse({ refreshToken: "abc.def" })).toEqual({
      refreshToken: "abc.def",
    });
  });

  it("rejects a missing refreshToken", () => {
    expect(() => logoutRequestSchema.parse({})).toThrow();
  });
});

describe("forgotPasswordRequestSchema", () => {
  it("accepts a valid payload and normalizes email", () => {
    expect(forgotPasswordRequestSchema.parse({ email: "User@Example.com" })).toEqual({
      email: "user@example.com",
    });
  });

  it("rejects a missing email", () => {
    expect(() => forgotPasswordRequestSchema.parse({})).toThrow();
  });

  it("rejects an invalid email", () => {
    expect(() => forgotPasswordRequestSchema.parse({ email: "not-an-email" })).toThrow();
  });
});

describe("resetPasswordRequestSchema", () => {
  const validPayload = {
    email: "User@Example.com",
    otp: "123456",
    newPassword: "Sup3r$ecretPassw0rd!",
  };

  it("accepts a valid payload and normalizes email", () => {
    expect(resetPasswordRequestSchema.parse(validPayload)).toEqual({
      email: "user@example.com",
      otp: "123456",
      newPassword: "Sup3r$ecretPassw0rd!",
    });
  });

  it("rejects a malformed otp", () => {
    expect(() =>
      resetPasswordRequestSchema.parse({ ...validPayload, otp: "12a456" }),
    ).toThrow();
  });

  it("rejects a new password that fails the strong-password policy", () => {
    expect(() =>
      resetPasswordRequestSchema.parse({ ...validPayload, newPassword: "weak" }),
    ).toThrow();
  });
});
