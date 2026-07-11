import pino from "pino";

export interface LoggerOptions {
  service: string;
  level?: string;
}

/**
 * Creates a structured JSON logger tagged with the owning service name.
 * All apps must use this instead of console.log for anything beyond
 * local debugging, per Claude Development Rule 11 (observability).
 */
export function createLogger(options: LoggerOptions): pino.Logger {
  return pino({
    level: options.level ?? "info",
    base: { service: options.service },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
