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
  // Optional at the schema level, but see the `superRefine` below:
  // - development / test: SMTP_HOST may be unset — the mail layer falls
  //   back to logging the (redacted) email to the server console.
  // - production: SMTP is mandatory. The console fallback would print
  //   plaintext OTPs, which must never happen in production, so startup
  //   fails validation instead of silently falling back.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),

  // ---- Phase 2 — OTP (registration / verification, Step 3) ----
  // How long a generated OTP (and the pending registration it belongs
  // to) remains valid.
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  // Wrong-code attempts allowed before the pending registration is
  // invalidated and the user must start over.
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // Minimum time between OTP sends for the same email (register or
  // resend), to prevent email-bombing a single address.
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),

  // ---- Phase 3 Step 3 — Avatar storage ----
  // MVP storage strategy: local disk, served back out over HTTP as static
  // files by the API itself (see `AvatarStorageService`/`main.ts`). There is
  // no existing pluggable object-storage abstraction in this repo yet (the
  // `OBJECT_STORAGE_*` vars below are reserved/unused placeholders from an
  // earlier phase, never implemented) — this is deliberately the first one,
  // built small and swappable rather than as a permanent architecture. A
  // future step can replace `AvatarStorageService`'s internals with a real
  // object-storage (S3-compatible) backend without changing any caller.
  //
  // - `AVATAR_STORAGE_DIR`: where uploaded avatar files are written on
  //   disk. Created automatically if it doesn't exist. Not committed to
  //   version control (see `.gitignore`).
  // - `AVATAR_PUBLIC_BASE_URL`: the externally-reachable origin avatar
  //   URLs are built from (e.g. `https://api.example.com`). Defaults to
  //   matching `API_PORT`'s own default for local development.
  // - `AVATAR_MAX_UPLOAD_BYTES`: the hard cap enforced both by Multer
  //   (a DoS backstop during upload) and, authoritatively, by
  //   `AvatarStorageService` itself after the file is buffered.
  AVATAR_STORAGE_DIR: z.string().min(1).default("./storage/avatars"),
  AVATAR_PUBLIC_BASE_URL: z.string().min(1).default("http://localhost:4000"),
  AVATAR_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

  // ---- Phase 4 Step 1 — OmniProvider credentials (foundation only) ----
  // All three are optional: this step never calls a real vendor API, and
  // a provider whose key is absent simply reports `configStatus:
  // "not-configured"` (see `apps/api/src/ai/providers/*.provider.ts`)
  // rather than crashing API startup. There is deliberately no
  // `superRefine` all-or-nothing rule here like SMTP's — each provider is
  // independent, so a missing `OPENAI_API_KEY` must never block Gemini
  // or Anthropic from being usable. Never logged (see
  // `env.test.ts`'s "never appears in a loaded Env's own enumerable
  // logging surface" style assertions for the equivalent pattern).
  GEMINI_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // ---- Phase 4 Step 2 — Anthropic real execution (timeout & retry) ----
  // Passed directly into the official `@anthropic-ai/sdk` client's own
  // `timeout`/`maxRetries` constructor options (see
  // `apps/api/src/ai/providers/anthropic-client.provider.ts`). There is
  // deliberately no custom retry/backoff loop anywhere in this codebase —
  // the SDK's own retry behavior (which already knows which failures are
  // safe to retry, e.g. 429/5xx/network errors, and which are not, e.g.
  // 400/401) is the single source of truth. Both optional with
  // production-reasonable defaults; independent of whether
  // `ANTHROPIC_API_KEY` is set, so they never block API startup.
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
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

  // Phase 2 Step 3 blocker fix: the console-logging mail fallback (which
  // would otherwise print the plaintext OTP/email body) is only a safe
  // default in development/test. In production there is no acceptable
  // "unconfigured" fallback — startup must fail loudly instead of ever
  // risking a plaintext OTP hitting production logs or stdout.
  if (env.NODE_ENV === "production" && smtpProvided.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SMTP_HOST"],
      message:
        "SMTP_HOST (and the rest of SMTP_*) is required in production — the console-logging " +
        "mail fallback is disabled outside development/test to prevent plaintext OTPs from " +
        "ever being written to logs.",
    });
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
