import { z } from "zod";

/**
 * Phase 0 environment schema.
 * Only variables required by the Foundation phase are validated here.
 * Future phases must extend this schema rather than bypassing it.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  API_CORS_ORIGIN: z.string().default("http://localhost:5173"),

  POSTGRES_URL: z.string().min(1, "POSTGRES_URL is required"),
  MONGO_URL: z.string().min(1, "MONGO_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  QDRANT_URL: z.string().min(1, "QDRANT_URL is required"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates a raw environment object.
 * Throws a descriptive error (no silent fallback) if required
 * variables are missing or malformed.
 */
export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
