import { z } from "zod";

/**
 * Environment schema.
 * Only variables required by approved, implemented phases are validated
 * here. Future phases must extend this schema rather than bypassing it.
 *
 * Phase 0: NODE_ENV..QDRANT_URL.
 * Phase 2 (Authentication & Users, Step 1): JWT_* and SMTP_* below.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  API_CORS_ORIGIN: z.string().default("http://localhost:5173"),

  POSTGRES_URL: z.string().min(1, "POSTGRES_URL is required"),
  MONGO_URL: z.string().min(1, "MONGO_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  QDRANT_URL: z.string().min(1, "QDRANT_URL is required"),

  // ---- Phase 2 — JWT (access/refresh tokens) ----
  // Secrets are always required: there is no safe "unconfigured" fallback
  // for signing auth tokens, unlike SMTP below.
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET is required and must be at least 32 characters"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET is required and must be at least 32 characters"),
  // Defaults match the approved Phase 2 decision (15m access / 7d refresh)
  // but remain overridable per-environment without a code change.
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

  // ---- Phase 2 — SMTP (OTP / transactional email) ----
  // All optional: if SMTP_HOST is unset, the mail layer falls back to
  // logging the OTP to the server console instead of failing (development
  // convenience — the mail layer, not this schema, decides how to react).
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
});

export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  // SMTP is all-or-nothing: partial configuration is almost always a
  // mistake (e.g. a typo'd var name) and must fail loudly rather than
  // silently sending misconfigured mail or silently falling back to
  // console-logging when the operator believed SMTP was active.
  const smtpFields = {
    SMTP_HOST: env.SMTP_HOST,
    SMTP_PORT: env.SMTP_PORT,
    SMTP_USER: env.SMTP_USER,
    SMTP_PASSWORD: env.SMTP_PASSWORD,
    SMTP_FROM: env.SMTP_FROM,
  } as const;
  const smtpProvided = Object.entries(smtpFields).filter(([, value]) => value !== undefined);

  if (smtpProvided.length > 0 && smtpProvided.length < Object.keys(smtpFields).length) {
    const missing = Object.entries(smtpFields)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key);
    for (const key of missing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required once any SMTP_* variable is set (all-or-nothing configuration)`,
      });
    }
  }
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

/**
 * Single source of truth for "is SMTP actually configured", used by the
 * mail layer to decide between sending real email and logging the OTP to
 * the console in development. Kept here (next to the schema that already
 * enforces all-or-nothing SMTP config) so no other module has to
 * re-implement the check.
 */
export function isSmtpConfigured(env: Env): boolean {
  return env.SMTP_HOST !== undefined;
}
