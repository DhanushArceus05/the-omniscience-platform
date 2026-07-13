import { describe, expect, it } from "vitest";
import { displayNameSchema, emailSchema, passwordSchema } from "./auth";

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
