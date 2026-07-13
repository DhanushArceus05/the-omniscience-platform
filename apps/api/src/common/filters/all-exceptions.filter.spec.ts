import { ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function createMockHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe("AllExceptionsFilter", () => {
  const logger = { error: jest.fn() } as unknown as import("pino").Logger;

  it("maps an HttpException to its status and message", () => {
    const filter = new AllExceptionsFilter(logger);
    const { host, json, status } = createMockHost();

    filter.catch(new HttpException("Not Found", HttpStatus.NOT_FOUND), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: "NOT_FOUND", message: "Not Found" },
    });
  });

  it("maps an unknown exception to a 500 without leaking internals", () => {
    const filter = new AllExceptionsFilter(logger);
    const { host, json, status } = createMockHost();

    filter.catch(new Error("db connection refused"), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  it("logs every exception", () => {
    const filter = new AllExceptionsFilter(logger);
    const { host } = createMockHost();

    filter.catch(new Error("boom"), host);

    expect(logger.error).toHaveBeenCalled();
  });

  it("surfaces structured `details` when the exception response includes them (Phase 2 validation)", () => {
    const filter = new AllExceptionsFilter(logger);
    const { host, json, status } = createMockHost();

    filter.catch(
      new HttpException(
        {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: [{ path: "email", message: "Enter a valid email address" }],
        },
        HttpStatus.BAD_REQUEST,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ path: "email", message: "Enter a valid email address" }],
      },
    });
  });
});
