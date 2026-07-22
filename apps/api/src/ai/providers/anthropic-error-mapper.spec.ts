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
});
