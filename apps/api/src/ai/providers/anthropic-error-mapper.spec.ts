import Anthropic from "@anthropic-ai/sdk";
import { mapAnthropicError } from "./anthropic-error-mapper";

const headers = new Headers();
const context = { providerId: "anthropic", modelId: "claude-sonnet-5" } as const;

describe("mapAnthropicError", () => {
  it("maps AuthenticationError and PermissionDeniedError to PROVIDER_AUTH_FAILED", () => {
    expect(
      mapAnthropicError(new Anthropic.AuthenticationError(401, {}, "x", headers), context)
        .getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }));
    expect(
      mapAnthropicError(new Anthropic.PermissionDeniedError(403, {}, "x", headers), context)
        .getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }));
  });

  it("maps RateLimitError to PROVIDER_RATE_LIMITED", () => {
    const result = mapAnthropicError(
      new Anthropic.RateLimitError(429, {}, "x", headers),
      context,
    );
    expect(result.getResponse()).toEqual(expect.objectContaining({ code: "PROVIDER_RATE_LIMITED" }));
    expect(result.getStatus()).toBe(429);
  });

  it("maps BadRequestError and UnprocessableEntityError to PROVIDER_REQUEST_INVALID", () => {
    expect(
      mapAnthropicError(new Anthropic.BadRequestError(400, {}, "x", headers), context).getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_REQUEST_INVALID" }));
    expect(
      mapAnthropicError(new Anthropic.UnprocessableEntityError(422, {}, "x", headers), context)
        .getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_REQUEST_INVALID" }));
  });

  it("maps InternalServerError to PROVIDER_UNAVAILABLE", () => {
    expect(
      mapAnthropicError(new Anthropic.InternalServerError(500, {}, "x", headers), context)
        .getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }));
  });

  it("maps any other APIError status (e.g. 404/409) to PROVIDER_UNAVAILABLE as a catch-all", () => {
    const notFound = Anthropic.APIError.generate(404, {}, "not found", headers);
    expect(mapAnthropicError(notFound, context).getResponse()).toEqual(
      expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
    );
  });

  it("maps APIConnectionTimeoutError to PROVIDER_TIMEOUT", () => {
    const result = mapAnthropicError(
      new Anthropic.APIConnectionTimeoutError({ message: "timed out" }),
      context,
    );
    expect(result.getResponse()).toEqual(expect.objectContaining({ code: "PROVIDER_TIMEOUT" }));
    expect(result.getStatus()).toBe(504);
  });

  it("maps a generic APIConnectionError (no HTTP response reached) to PROVIDER_UNAVAILABLE", () => {
    const result = mapAnthropicError(
      new Anthropic.APIConnectionError({ message: "connection failed" }),
      context,
    );
    expect(result.getResponse()).toEqual(expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }));
  });

  it("maps a completely unrecognized thrown value to PROVIDER_UNAVAILABLE without throwing itself", () => {
    expect(mapAnthropicError("not even an Error instance", context).getResponse()).toEqual(
      expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
    );
    expect(mapAnthropicError(undefined, context).getResponse()).toEqual(
      expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
    );
  });

  it("never includes the raw SDK error's message, body, or headers in the normalized response", () => {
    const secret = "leaked-internal-detail-should-never-appear";
    const error = new Anthropic.BadRequestError(400, { detail: secret }, secret, headers);
    const response = mapAnthropicError(error, context).getResponse();
    expect(JSON.stringify(response)).not.toContain(secret);
  });

  it("includes the providerId and modelId in the message, but never a credential-shaped value", () => {
    const response = mapAnthropicError(
      new Anthropic.AuthenticationError(401, {}, "x", headers),
      context,
    ).getResponse() as { message: string };
    expect(response.message).toContain("anthropic");
  });

  // Phase 4 Step 5: defense-in-depth structural fallback, added after
  // Phase 4 Step 4's real Gemini incident showed that relying on
  // `instanceof` checks alone (with nothing behind them) is a risk for
  // *any* vendor SDK, not just Google's — see
  // `provider-error-utils.ts`'s doc comment. None of these fixtures are
  // `instanceof` any `@anthropic-ai/sdk` error class; every existing
  // test above (which are) is unaffected, since those `instanceof`
  // checks still run first and still match first.
  describe("structural fallback (defense-in-depth, mirrors gemini-error-mapper.ts)", () => {
    it("maps a duck-typed object with a numeric status but a foreign prototype to PROVIDER_AUTH_FAILED", () => {
      class UnrelatedError extends Error {
        readonly status: number;
        constructor(message: string, status: number) {
          super(message);
          this.name = "UnrelatedError";
          this.status = status;
        }
      }
      const error = new UnrelatedError("some vendor-internal wording", 401);

      expect(error instanceof Anthropic.APIError).toBe(false);
      expect(mapAnthropicError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }),
      );
    });

    it("unwraps a wrapper Error exposing the real status via `.cause`", () => {
      const inner = { status: 429, message: "rate limited" };
      const wrapper = new Error("Permanent error", { cause: inner });
      wrapper.name = "PermanentError";

      expect(mapAnthropicError(wrapper, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_RATE_LIMITED" }),
      );
    });

    it("maps a structural 400/422 to PROVIDER_REQUEST_INVALID and a structural 5xx to PROVIDER_UNAVAILABLE", () => {
      expect(mapAnthropicError({ status: 400 }, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_REQUEST_INVALID" }),
      );
      expect(mapAnthropicError({ status: 422 }, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_REQUEST_INVALID" }),
      );
      expect(mapAnthropicError({ status: 503 }, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
      );
    });

    it("maps a structural timeout (AbortError/TimeoutError by name, no status) to PROVIDER_TIMEOUT", () => {
      const timeoutError = new Error("timed out");
      timeoutError.name = "TimeoutError";
      expect(mapAnthropicError(timeoutError, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_TIMEOUT" }),
      );
    });

    it("does not loop forever or throw on a self-referential `.cause` cycle", () => {
      const cyclic = new Error("cyclic") as Error & { cause?: unknown };
      cyclic.cause = cyclic;

      expect(() => mapAnthropicError(cyclic, context)).not.toThrow();
      expect(mapAnthropicError(cyclic, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
      );
    });
  });

  // Phase 4 Step 5: same optional-logger diagnostic as
  // gemini-error-mapper.ts — see that file's equivalent describe block.
  describe("optional logger (Phase 4 Step 5 production hardening)", () => {
    it("warns exactly once, with a secret-free structural fingerprint, only when every classification attempt fails", () => {
      const logger = { warn: jest.fn() };
      const error = new Error("a completely unrecognized shape");

      mapAnthropicError(error, context, logger);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "anthropic",
          modelId: "claude-sonnet-5",
          errorName: "Error",
        }),
        expect.stringContaining("unrecognized error shape"),
      );
    });

    it("never calls the logger when the error is classified via the primary instanceof chain", () => {
      const logger = { warn: jest.fn() };
      mapAnthropicError(new Anthropic.AuthenticationError(401, {}, "x", headers), context, logger);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("never calls the logger when classified via the structural fallback", () => {
      const logger = { warn: jest.fn() };
      mapAnthropicError({ status: 429 }, context, logger);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("never includes the raw error message in the logged fingerprint", () => {
      const logger = { warn: jest.fn() };
      const secret = "leaked-internal-detail-should-never-appear";
      mapAnthropicError(new Error(secret), context, logger);
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(secret);
    });

    it("works exactly as before when no logger is given (fully optional, no throw)", () => {
      expect(() => mapAnthropicError(new Error("unrecognized"), context)).not.toThrow();
      expect(mapAnthropicError(new Error("unrecognized"), context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
      );
    });
  });
});
