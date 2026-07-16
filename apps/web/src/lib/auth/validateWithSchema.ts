import type { FieldErrors } from "./authErrors";

interface ZodLikeIssue {
  path: Array<string | number>;
  message: string;
}

interface ZodLikeSafeParseResult<T> {
  success: boolean;
  data?: T;
  error?: { issues: ZodLikeIssue[] };
}

interface ZodLikeSchema<T> {
  safeParse(value: unknown): ZodLikeSafeParseResult<T>;
}

/**
 * Runs a shared `@omniscience/schemas` zod schema client-side, ahead of
 * the network round-trip, so a form gets the same field-level messages
 * `ZodValidationPipe` would return from the server — without duplicating
 * a single validation rule. Returns `{ valid: true, data }` on success or
 * `{ valid: false, fieldErrors }` (same shape as `getFieldErrors`, keyed
 * by field path) on failure.
 */
export function validateWithSchema<T>(
  schema: ZodLikeSchema<T>,
  value: unknown,
): { valid: true; data: T } | { valid: false; fieldErrors: FieldErrors } {
  const result = schema.safeParse(value);
  if (result.success && result.data !== undefined) {
    return { valid: true, data: result.data };
  }
  const fieldErrors: FieldErrors = {};
  for (const issue of result.error?.issues ?? []) {
    const path = issue.path.join(".");
    if (path && !(path in fieldErrors)) {
      fieldErrors[path] = issue.message;
    }
  }
  return { valid: false, fieldErrors };
}
