import { ApiError } from "@google/genai";
import { mapGeminiError } from "./gemini-error-mapper";

const context = { providerId: "gemini", modelId: "gemini-3.5-flash" } as const;

describe("mapGeminiError", () => {
  it("maps 401 and 403 ApiError statuses to PROVIDER_AUTH_FAILED", () => {
    expect(
      mapGeminiError(new ApiError({ message: "x", status: 401 }), context).getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }));
    expect(
      mapGeminiError(new ApiError({ message: "x", status: 403 }), context).getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }));
  });

  it("maps 429 to PROVIDER_RATE_LIMITED", () => {
    const result = mapGeminiError(new ApiError({ message: "x", status: 429 }), context);
    expect(result.getResponse()).toEqual(expect.objectContaining({ code: "PROVIDER_RATE_LIMITED" }));
    expect(result.getStatus()).toBe(429);
  });

  it("maps 400 to PROVIDER_REQUEST_INVALID", () => {
    expect(
      mapGeminiError(new ApiError({ message: "x", status: 400 }), context).getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_REQUEST_INVALID" }));
  });

  it("maps any 5xx status to PROVIDER_UNAVAILABLE", () => {
    expect(
      mapGeminiError(new ApiError({ message: "x", status: 500 }), context).getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }));
    expect(
      mapGeminiError(new ApiError({ message: "x", status: 503 }), context).getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }));
  });

  it("maps any other ApiError status (e.g. 404/409) to PROVIDER_UNAVAILABLE as a catch-all", () => {
    expect(
      mapGeminiError(new ApiError({ message: "not found", status: 404 }), context).getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }));
  });

  it("maps an AbortError (request timeout) to PROVIDER_TIMEOUT", () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "AbortError";
    const result = mapGeminiError(timeoutError, context);
    expect(result.getResponse()).toEqual(expect.objectContaining({ code: "PROVIDER_TIMEOUT" }));
    expect(result.getStatus()).toBe(504);
  });

  it("maps a TimeoutError to PROVIDER_TIMEOUT", () => {
    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    expect(mapGeminiError(timeoutError, context).getResponse()).toEqual(
      expect.objectContaining({ code: "PROVIDER_TIMEOUT" }),
    );
  });

  it("maps a generic network-level Error (no ApiError, no timeout) to PROVIDER_UNAVAILABLE", () => {
    expect(
      mapGeminiError(new TypeError("fetch failed"), context).getResponse(),
    ).toEqual(expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }));
  });

  it("maps a completely unrecognized thrown value to PROVIDER_UNAVAILABLE without throwing itself", () => {
    expect(mapGeminiError("not even an Error instance", context).getResponse()).toEqual(
      expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
    );
    expect(mapGeminiError(undefined, context).getResponse()).toEqual(
      expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
    );
  });

  it("never includes the raw SDK error's message in the normalized response", () => {
    const secret = "leaked-internal-detail-should-never-appear";
    const error = new ApiError({ message: secret, status: 400 });
    const response = mapGeminiError(error, context).getResponse();
    expect(JSON.stringify(response)).not.toContain(secret);
  });

  it("includes the providerId in the message, but never a credential-shaped value", () => {
    const response = mapGeminiError(
      new ApiError({ message: "x", status: 401 }),
      context,
    ).getResponse() as { message: string };
    expect(response.message).toContain("gemini");
  });

  // Regression coverage for a real local-runtime gap: an invalid/
  // placeholder GEMINI_API_KEY produced an error that did NOT satisfy
  // `error instanceof ApiError`, so it fell through to the generic
  // PROVIDER_UNAVAILABLE fallback instead of PROVIDER_AUTH_FAILED. See
  // this module's "Why this does NOT use `error instanceof ApiError`"
  // doc comment for the full reasoning; these tests exercise the
  // structural detection that replaced the nominal check.
  describe("structural detection (regression: real errors that are not `instanceof ApiError`)", () => {
    it("maps a duck-typed object with a numeric status but a foreign/duplicated prototype to PROVIDER_AUTH_FAILED", () => {
      // Same own-property shape a real ApiError has (`status`, `message`),
      // but deliberately NOT constructed via `new ApiError(...)` and NOT
      // sharing its prototype — simulating a structurally-identical error
      // from a duplicated/hoisted copy of the package, or any SDK
      // internal that builds its own error-like object.
      class UnrelatedError extends Error {
        readonly status: number;
        constructor(message: string, status: number) {
          super(message);
          this.name = "UnrelatedError";
          this.status = status;
        }
      }
      const error = new UnrelatedError("some vendor-internal wording", 401);

      expect(error instanceof ApiError).toBe(false);
      expect(mapGeminiError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }),
      );
    });

    it("maps a plain (non-Error) object literal with a numeric status", () => {
      const error = { status: 429, message: "rate limited" };
      expect(mapGeminiError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_RATE_LIMITED" }),
      );
    });

    it("unwraps a PermanentError-style wrapper exposing the real ApiError via `.cause`", () => {
      // Mirrors the SDK's own retry-layer convention of terminating
      // retries by throwing a differently-named wrapper Error with the
      // original error attached as `.cause` — the wrapper itself is not
      // `instanceof ApiError`, but the thing that matters (the status)
      // is one level down.
      const innerApiError = new ApiError({
        message: "API key not valid. Please pass a valid API key.",
        status: 400,
      });
      const wrapper = new Error("Permanent error", { cause: innerApiError });
      wrapper.name = "PermanentError";

      expect(wrapper instanceof ApiError).toBe(false);
      const result = mapGeminiError(wrapper, context);
      // Both the cause-unwrapping AND the 400-auth-message override are
      // exercised by this single fixture, since this is the exact real
      // shape (wrapped + a 400 "API key not valid" body) that caused the
      // original bug report.
      expect(result.getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }),
      );
    });

    it("unwraps two levels of `.cause` before giving up", () => {
      const innerApiError = new ApiError({ message: "rate limited", status: 429 });
      const middleWrapper = new Error("wrapped once", { cause: innerApiError });
      const outerWrapper = new Error("wrapped twice", { cause: middleWrapper });

      expect(mapGeminiError(outerWrapper, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_RATE_LIMITED" }),
      );
    });

    it("does not loop forever or throw on a self-referential `.cause` cycle", () => {
      const cyclic = new Error("cyclic") as Error & { cause?: unknown };
      cyclic.cause = cyclic;

      expect(() => mapGeminiError(cyclic, context)).not.toThrow();
      expect(mapGeminiError(cyclic, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
      );
    });
  });

  // Regression coverage for Google's own backend not reliably using
  // 401/403 for an invalid API key — it commonly returns a 400 whose
  // message describes the credential problem instead.
  describe("400-as-auth-failure quirk (Gemini-specific)", () => {
    it("maps a 400 whose message says the API key is not valid to PROVIDER_AUTH_FAILED, not PROVIDER_REQUEST_INVALID", () => {
      const error = new ApiError({
        message: "API key not valid. Please pass a valid API key.",
        status: 400,
      });
      expect(mapGeminiError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }),
      );
    });

    it("maps a 400 whose message reports the machine-readable API_KEY_INVALID reason to PROVIDER_AUTH_FAILED", () => {
      const error = new ApiError({
        message: JSON.stringify({
          error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" },
          reason: "API_KEY_INVALID",
        }),
        status: 400,
      });
      expect(mapGeminiError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }),
      );
    });

    it("still maps an ordinary 400 with no auth-related wording to PROVIDER_REQUEST_INVALID", () => {
      const error = new ApiError({
        message: "The request contents must not be empty.",
        status: 400,
      });
      expect(mapGeminiError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_REQUEST_INVALID" }),
      );
    });

    it("never includes the auth-detection message text itself in the normalized response", () => {
      const error = new ApiError({
        message: "API key not valid. Please pass a valid API key.",
        status: 400,
      });
      const response = mapGeminiError(error, context).getResponse();
      expect(JSON.stringify(response)).not.toContain("API key not valid");
    });
  });

  // Defense-in-depth regression coverage: gemini-client.provider.ts no
  // longer configures httpOptions.retryOptions (see that file's doc
  // comment for the full root-cause trace), so this exact shape should
  // no longer occur in production — but this proves the mapper still
  // recovers a usable status if it ever does (e.g. a future change
  // reintroduces retryOptions by accident).
  describe("p-retry lossy-message fallback (defense-in-depth, matches p-retry@4.6.2's exact wording)", () => {
    it("maps the exact 'Non-retryable exception <reason>' shape p-retry produces for a 400", () => {
      // No `.status`, no `.cause` — a plain Error, exactly as
      // `p-retry`'s `AbortError.originalError` is constructed. This is
      // the literal shape that caused the original PROVIDER_UNAVAILABLE
      // bug report before `retryOptions` was removed from the client.
      const error = new Error("Non-retryable exception Bad Request sending request");
      expect((error as { status?: unknown }).status).toBeUndefined();
      expect((error as { cause?: unknown }).cause).toBeUndefined();

      // The response body ("API key not valid...") never survives this
      // shape, so this can only recover the bare status (400) — not the
      // auth-specific classification a real ApiError would get. This is
      // exactly the documented, accepted trade-off of this fallback.
      expect(mapGeminiError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_REQUEST_INVALID" }),
      );
    });

    it("maps 'Non-retryable exception Unauthorized sending request' to PROVIDER_AUTH_FAILED", () => {
      const error = new Error("Non-retryable exception Unauthorized sending request");
      expect(mapGeminiError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }),
      );
    });

    it("maps the exact 'Retryable HTTP Error: <reason>' shape p-retry produces after exhausting retries", () => {
      const error = new Error("Retryable HTTP Error: Service Unavailable");
      expect(mapGeminiError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
      );
    });

    it("maps 'Retryable HTTP Error: Too Many Requests' to PROVIDER_RATE_LIMITED", () => {
      const error = new Error("Retryable HTTP Error: Too Many Requests");
      expect(mapGeminiError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_RATE_LIMITED" }),
      );
    });

    it("does not misfire on an unrelated message that merely contains similar words", () => {
      const error = new Error("Bad request handling in an unrelated subsystem");
      expect(mapGeminiError(error, context).getResponse()).toEqual(
        expect.objectContaining({ code: "PROVIDER_UNAVAILABLE" }),
      );
    });

    it("never leaks the recovered reason-phrase text itself in the normalized response", () => {
      const error = new Error("Non-retryable exception Unauthorized sending request");
      const response = mapGeminiError(error, context).getResponse();
      expect(JSON.stringify(response)).not.toContain("Unauthorized");
      expect(JSON.stringify(response)).not.toContain("sending request");
    });
  });
});
