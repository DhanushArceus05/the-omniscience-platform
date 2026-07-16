/**
 * Thrown by `OmniscienceClient`'s auth methods whenever the API responds
 * with the shared `ApiError` envelope (see `@omniscience/types`). Carries
 * the structured `code`/`details` through to callers (e.g. `apps/web`)
 * so UI can distinguish e.g. `EMAIL_ALREADY_REGISTERED` from
 * `VALIDATION_ERROR` instead of pattern-matching on message strings.
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(params: { code: string; message: string; status: number; details?: unknown }) {
    super(params.message);
    this.name = "ApiClientError";
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
  }
}
