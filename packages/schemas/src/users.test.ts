import { describe, expect, it } from "vitest";
import { changePasswordRequestSchema, deleteAccountRequestSchema, updateProfileRequestSchema } from "./users";

describe("updateProfileRequestSchema", () => {
  it("accepts a valid payload, trimming the name", () => {
    expect(updateProfileRequestSchema.parse({ name: "  Ada Lovelace  " })).toEqual({
      name: "Ada Lovelace",
    });
  });

  it("rejects a name that is too short", () => {
    expect(() => updateProfileRequestSchema.parse({ name: "A" })).toThrow();
  });

  it("rejects a missing name", () => {
    expect(() => updateProfileRequestSchema.parse({})).toThrow();
  });
});

describe("changePasswordRequestSchema", () => {
  const validPayload = {
    currentPassword: "OldPassw0rd!",
    newPassword: "N3wSup3r$ecretPassw0rd!",
  };

  it("accepts a valid payload", () => {
    expect(changePasswordRequestSchema.parse(validPayload)).toEqual(validPayload);
  });

  it("rejects a missing current password", () => {
    expect(() =>
      changePasswordRequestSchema.parse({ newPassword: validPayload.newPassword }),
    ).toThrow();
  });

  it("rejects a new password that fails the strong-password policy", () => {
    expect(() =>
      changePasswordRequestSchema.parse({ ...validPayload, newPassword: "weak" }),
    ).toThrow();
  });
});

describe("deleteAccountRequestSchema", () => {
  it("accepts a valid payload", () => {
    expect(deleteAccountRequestSchema.parse({ password: "CorrectPassw0rd!" })).toEqual({
      password: "CorrectPassw0rd!",
    });
  });

  it("rejects a missing password", () => {
    expect(() => deleteAccountRequestSchema.parse({})).toThrow();
  });

  it("rejects an empty password", () => {
    expect(() => deleteAccountRequestSchema.parse({ password: "" })).toThrow();
  });
});
