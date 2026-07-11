import { describe, expect, it } from "vitest";
import { err, isErr, isOk, ok } from "./result";

describe("Result helpers", () => {
  it("wraps a success value", () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it("wraps a failure value", () => {
    const result = err(new Error("boom"));
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error.message).toBe("boom");
    }
  });
});
