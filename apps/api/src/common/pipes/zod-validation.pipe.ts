import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

export interface ValidationErrorDetail {
  path: string;
  message: string;
}

interface ZodLikeIssue {
  path: Array<string | number>;
  message: string;
}

interface ZodLikeSafeParseSuccess<T> {
  success: true;
  data: T;
}

interface ZodLikeSafeParseFailure {
  success: false;
  error: { issues: ZodLikeIssue[] };
}

type ZodLikeSafeParseResult<T> = ZodLikeSafeParseSuccess<T> | ZodLikeSafeParseFailure;

/**
 * Structurally typed (not importing `zod` directly) so this file has no
 * dependency of its own on the `zod` package — schemas always come from
 * `@omniscience/schemas`, which already owns that dependency. Any real
 * Zod schema's `safeParse` return type satisfies this shape.
 */
interface ZodLikeSchema<T> {
  safeParse(value: unknown): ZodLikeSafeParseResult<T>;
}

/**
 * Generic Nest pipe that validates a request payload against a shared
 * Zod schema (from `@omniscience/schemas`), so validation rules live
 * once instead of being re-implemented per-endpoint or duplicated via
 * class-validator decorators.
 *
 * On failure, throws a `BadRequestException` with a structured,
 * safe body: a stable `code`, a generic `message`, and per-field
 * `details` (path + message only — never the offending value, so
 * passwords or other sensitive input are never echoed back or logged).
 *
 * Phase 2 Step 2 scope: the pipe itself, ready for Step 3/4 endpoints to
 * use with `@Body(new ZodValidationPipe(someRequestSchema))`. No
 * registration/login DTOs are wired to a controller yet.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodLikeSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details: ValidationErrorDetail[] = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details,
      });
    }
    return result.data;
  }
}
