import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@omniscience/types";
import type { Response } from "express";
import { MulterError } from "multer";

/**
 * Multer's own errors (thrown while parsing the multipart body itself —
 * e.g. exceeding the `MulterModule`-configured `limits.fileSize` DoS
 * backstop) are plain `Error` subclasses, not NestJS `HttpException`s,
 * so `AllExceptionsFilter`'s catch-all would otherwise turn them into a
 * generic, unstructured `500`. This route-scoped filter (applied only
 * to the avatar-upload endpoint) maps them to the same
 * `{ success: false, error: { code, message } }` envelope every other
 * error in this API already uses, with a proper `413`/`400` status
 * instead of a `500`.
 *
 * `AvatarStorageService.assertValid`'s own size check is still the
 * *authoritative* one (see its docstring) — this filter only covers the
 * earlier, coarser backstop Multer enforces before that code ever runs.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const body: ApiError =
      exception.code === "LIMIT_FILE_SIZE"
        ? {
            success: false,
            error: { code: "AVATAR_TOO_LARGE", message: "The uploaded file is too large." },
          }
        : {
            success: false,
            error: { code: "AVATAR_UPLOAD_ERROR", message: "The avatar could not be uploaded." },
          };

    const status =
      exception.code === "LIMIT_FILE_SIZE" ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST;

    response.status(status).json(body);
  }
}
