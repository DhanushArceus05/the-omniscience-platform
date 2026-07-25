import {
  describeUnrecognizedError,
  extractStatusInfo,
  isTimeoutErrorByName,
} from "./provider-error-utils";

describe("extractStatusInfo", () => {
  it("reads a numeric status directly off the error", () => {
    expect(extractStatusInfo({ status: 401, message: "x" })).toEqual({
      status: 401,
      message: "x",
    });
  });

  it("returns message as undefined when the error has no string message", () => {
    expect(extractStatusInfo({ status: 500 })).toEqual({ status: 500, message: undefined });
  });

  it("unwraps `.cause` when the error itself has no status", () => {
    const inner = { status: 429, message: "rate limited" };
    const outer = new Error("wrapper", { cause: inner });
    expect(extractStatusInfo(outer)).toEqual({ status: 429, message: "rate limited" });
  });

  it("unwraps multiple levels of `.cause`", () => {
    const inner = { status: 503 };
    const middle = new Error("middle", { cause: inner });
    const outer = new Error("outer", { cause: middle });
    expect(extractStatusInfo(outer)?.status).toBe(503);
  });

  it("gives up after MAX_CAUSE_DEPTH levels rather than recursing forever", () => {
    // Six levels deep, each one below the next via `.cause` — one more
    // than this module's internal cap, so the innermost `status` must
    // NOT be found.
    let current: unknown = { status: 999 };
    for (let i = 0; i < 6; i += 1) {
      current = new Error(`level ${i}`, { cause: current });
    }
    expect(extractStatusInfo(current)).toBeUndefined();
  });

  it("does not loop forever or throw on a self-referential `.cause` cycle", () => {
    const cyclic = new Error("cyclic") as Error & { cause?: unknown };
    cyclic.cause = cyclic;
    expect(() => extractStatusInfo(cyclic)).not.toThrow();
    expect(extractStatusInfo(cyclic)).toBeUndefined();
  });

  it("returns undefined for null, primitives, and objects with no status/cause", () => {
    expect(extractStatusInfo(null)).toBeUndefined();
    expect(extractStatusInfo(undefined)).toBeUndefined();
    expect(extractStatusInfo("a string")).toBeUndefined();
    expect(extractStatusInfo(42)).toBeUndefined();
    expect(extractStatusInfo({})).toBeUndefined();
    expect(extractStatusInfo(new Error("plain"))).toBeUndefined();
  });

  it("consults fallbackFromMessage only after the structural search is exhausted", () => {
    const fallbackFromMessage = jest.fn().mockReturnValue(418);
    const result = extractStatusInfo(new Error("some message"), { fallbackFromMessage });
    expect(fallbackFromMessage).toHaveBeenCalledWith("some message");
    expect(result).toEqual({ status: 418, message: undefined });
  });

  it("never consults fallbackFromMessage when a structural status was already found", () => {
    const fallbackFromMessage = jest.fn();
    extractStatusInfo({ status: 400, message: "x" }, { fallbackFromMessage });
    expect(fallbackFromMessage).not.toHaveBeenCalled();
  });

  it("returns undefined when fallbackFromMessage itself finds nothing", () => {
    const fallbackFromMessage = jest.fn().mockReturnValue(undefined);
    expect(extractStatusInfo(new Error("unmatched"), { fallbackFromMessage })).toBeUndefined();
  });
});

describe("isTimeoutErrorByName", () => {
  it("recognizes AbortError and TimeoutError by name", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(isTimeoutErrorByName(abort)).toBe(true);
    expect(isTimeoutErrorByName(timeout)).toBe(true);
  });

  it("returns false for any other Error name, and for non-Error values", () => {
    expect(isTimeoutErrorByName(new Error("plain"))).toBe(false);
    expect(isTimeoutErrorByName("not an error")).toBe(false);
    expect(isTimeoutErrorByName(undefined)).toBe(false);
    expect(isTimeoutErrorByName({ name: "AbortError" })).toBe(false);
  });
});

describe("describeUnrecognizedError", () => {
  it("returns a structural fingerprint for an Error, without its message", () => {
    const error = new Error("some secret detail");
    error.name = "WeirdError";
    const fingerprint = describeUnrecognizedError(error);
    expect(fingerprint).toEqual({
      errorName: "WeirdError",
      errorConstructor: "Error",
      hasCause: false,
    });
    expect(JSON.stringify(fingerprint)).not.toContain("some secret detail");
  });

  it("reports hasCause: true when a `.cause` is present", () => {
    const error = new Error("outer", { cause: new Error("inner secret") });
    const fingerprint = describeUnrecognizedError(error);
    expect(fingerprint).toEqual(
      expect.objectContaining({ hasCause: true }),
    );
    expect(JSON.stringify(fingerprint)).not.toContain("inner secret");
  });

  it("falls back to a plain typeof for non-Error values", () => {
    expect(describeUnrecognizedError("a string")).toEqual({ errorType: "string" });
    expect(describeUnrecognizedError(undefined)).toEqual({ errorType: "undefined" });
    expect(describeUnrecognizedError({ status: 1 })).toEqual({ errorType: "object" });
  });
});
