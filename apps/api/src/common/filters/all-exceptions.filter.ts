import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import type { Logger } from "pino";
import type { ApiError } from "@omniscience/types";

/**
 * Catches every unhandled exception and returns the shared ApiError
 * envelope instead of leaking stack traces or Express defaults.
 * Never fails silently: every error is logged with context.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = isHttpException ? exception.message : "Internal server error";

    // Some exceptions (e.g. ZodValidationPipe's BadRequestException) carry a
    // structured body with their own stable `code` (and per-field
    // `details`) — prefer that over the generic HTTP status name so
    // clients can distinguish e.g. "VALIDATION_ERROR" from any other 400.
    // Every exception without a structured body keeps the exact previous
    // behavior (code derived from the HTTP status name).
    const httpResponseBody = isHttpException ? exception.getResponse() : undefined;
    const hasStructuredBody = httpResponseBody !== null && typeof httpResponseBody === "object";

    const customCode =
      hasStructuredBody && typeof (httpResponseBody as { code?: unknown }).code === "string"
        ? (httpResponseBody as { code: string }).code
        : undefined;
    const code =
      customCode ?? (isHttpException ? (HttpStatus[status] ?? "HTTP_ERROR") : "INTERNAL_ERROR");

    const details = hasStructuredBody
      ? (httpResponseBody as { details?: unknown }).details
      : undefined;

    this.logger.error(
      {
        status,
        code,
        err: exception instanceof Error ? exception.stack : exception,
      },
      "unhandled exception",
    );

    const body: ApiError = {
      success: false,
      error: details !== undefined ? { code, message, details } : { code, message },
    };

    response.status(status).json(body);
  }
}
