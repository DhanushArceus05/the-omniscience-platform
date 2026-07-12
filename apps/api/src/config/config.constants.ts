/**
 * DI tokens for the validated environment and the shared structured
 * logger. Kept as plain string tokens (not classes) since `Env` is a
 * type, not a class, and pino's `Logger` is a third-party interface.
 */
export const ENV = "ENV";
export const LOGGER = "LOGGER";
