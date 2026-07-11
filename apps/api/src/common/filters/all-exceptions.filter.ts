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

    const code = isHttpException ? (HttpStatus[status] ?? "HTTP_ERROR") : "INTERNAL_ERROR";

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
      error: { code, message },
    };

    response.status(status).json(body);
  }
}
