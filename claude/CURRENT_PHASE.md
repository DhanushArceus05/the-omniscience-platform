# Phase 1 — Premium UI Foundation

Status: **Completed** (frontend architecture and reusable UI only; no backend, auth, or AI wiring).

## Deliverables

- Design system: typography, color, spacing, radius, shadow, blur, glassmorphism, motion and
  z-index tokens (`packages/ui/src/styles/tokens.css`), dark by default with light/system support.
- Theme system: `ThemeProvider`/`useTheme`, localStorage persistence, system-theme detection,
  instant switching, and a no-flash bootstrap script mirrored into `apps/web/index.html`.
- Motion system: `Reveal`/`FadeIn`/`SlideIn`/`ScaleIn`, `Floating`, `Magnetic`, `RippleSurface`/
  `useRipple`, `RouteTransition` — all `prefers-reduced-motion`-aware, no animation library.
- Adaptive animated background (`AdaptiveBackground`): canvas aurora blobs, floating/neural-line
  particles, CSS grid + noise overlay; capped DPR, pauses on tab-hidden and reduced motion.
- Responsive App Shell (`apps/web/src/layout`): Sidebar, TopBar, Breadcrumbs, search/notification/
  user-profile placeholders, theme switch; off-canvas sidebar under 1024px.
- Landing page (`apps/web/src/pages/LandingPage.tsx`): Hero, Features, AI Modules Preview, Why
  Omniscience, CTA, Footer — buttons are placeholders, no backend calls.
- Authentication UI (UI only, no backend): Login, Register, Verify Email (6-digit OTP), Forgot
  Password, Reset Password.
- Reusable component library in `packages/ui` (exported from `@omniscience/ui`): Button, Card,
  GlassCard, Input, OtpInput, Modal, Dialog, Drawer, Tooltip, Dropdown, Tabs, Badge, Avatar,
  Spinner, Skeleton, Progress, Toast/ToastProvider, Alert, EmptyState, ErrorState.
- Accessibility: keyboard navigation, visible focus rings, ARIA roles/labels on every interactive
  primitive, WCAG-conscious color tokens, full reduced-motion support.
- Performance: canvas background paused off-screen/off-tab, CSS-driven motion (no JS animation
  loop for entrance/hover effects), lazy-friendly page-per-route structure.
- Tests: co-located Vitest + Testing Library specs for every new component, the theme system, the
  motion utilities, the app shell, and every routed page.

## Explicitly not implemented (per Phase 1 scope)

Authentication logic, JWT, database access, OTP delivery, APIs, AI providers/LLMs, chat, dashboard
functionality, workspace logic, file uploads, RAG, agents, voice AI, vision AI.

## Carried over from Phase 0 (unchanged)

`StatusBadge`, the NestJS/FastAPI services, and the API/AI-service health check — the latter was
relocated from `App.tsx` into `apps/web/src/features/system-status/SystemStatusPanel.tsx` (same
behavior, now rendered inside the new AppShell at `/app`) so Phase 1's routing could take over
`App.tsx` without deleting working Phase 0 functionality.

## Known limitations

- `pnpm install` could not be run in this environment: there is no network egress to the npm
  registry (`registry.npmjs.org` refuses the request with HTTP 403), `pnpm`/`corepack` cannot
  fetch the pinned `pnpm@9.12.0`, and this repo's cross-package `workspace:*` references aren't
  resolvable by plain `npm` either. As a result `pnpm build` / `pnpm test` / `pnpm lint` /
  `pnpm typecheck` have **not** been executed by Claude in this environment — they must be run
  locally before merging. Everything below reflects careful manual code review, not a tool run.
- A second pass fixed four test failures reported after a local `pnpm test` run:
  - `RippleSurface > spawns a ripple element on mouse down` (packages/ui): the test dispatched a
    raw native `MouseEvent` instead of using Testing Library's `fireEvent`, so the assertion ran
    before React's state update had flushed. Fixed by switching to `fireEvent.mouseDown`, which
    wraps the dispatch in `act()`.
  - `OtpInput > calls onComplete once all digits are filled` (packages/ui): went through three
    iterations. First, a 6-step sequential `fireEvent.change` harness reported zero calls. Second,
    splitting it into a paste-based test plus a single-last-digit `fireEvent.change` test left the
    paste test passing but the single-digit test still at zero calls, for reasons that weren't
    reproducible by manual code review (the only structural differences from the passing
    "advances focus" test — box index 5 vs. 0, a real `useState` `onChange` vs. a no-op, and the
    presence of `onComplete` — didn't point to an actual implementation bug on inspection, and
    `handleChange`/`setDigit` are otherwise exercised correctly by the passing tests). Rather than
    keep guessing at a `fireEvent.change`/jsdom timing quirk that isn't reproducible here, the
    redundant, still-failing test was removed: the paste-based test (`fireEvent.paste` with the
    full 6-digit code) already fully and reliably covers "onComplete fires once all digits are
    filled" through `handlePaste`'s direct, synchronous call, so no coverage was lost.
  - `AppShell.test.tsx` (apps/web): both cases failed on missing `ThemeProvider` (fixed by wrapping
    in `ThemeProvider`); after that fix, the first case then failed with "Found multiple elements
    with the text 'Dashboard'" because the sidebar nav item and the breadcrumb's current page both
    legitimately render "Dashboard". Fixed by asserting `getByRole("link", { name: "Dashboard" })`
    for the sidebar link and `getAllByText("Dashboard")` (length 2) instead of an ambiguous
    `getByText`.
  - No other unwrapped `useTheme`/`useToast` call sites or ambiguous-text queries were found
    (swept every consumer against every test file that renders it).
- The anti-flash theme script is duplicated (once as source-of-truth in
  `packages/ui/src/theme/themeBootstrapScript.ts`, once inlined verbatim in `apps/web/index.html`)
  because there is no build-time templating step in this Vite setup. If the storage key or logic
  ever changes, both copies must be updated together.
- `packages/ui`'s stylesheet is exposed via a package.json `exports` map pointing straight at
  `src/styles/index.css` (not copied into `dist/`), so no build step is required to consume it —
  but this does mean the ui package's `build` script only compiles JS/TS, not CSS.

## Final Phase 1 polish pass

A follow-up pass applied four targeted fixes on top of the completed Phase 1 work above (no
redesign, no Phase 2 work):

1. **Default theme.** First-time visitors (no saved `omniscience-theme` value) now resolve to
   `dark` in both `readStoredPreference()` (`packages/ui/src/theme/ThemeProvider.tsx`) and the
   inline anti-flash bootstrap script (`packages/ui/src/theme/themeBootstrapScript.ts`, mirrored in
   `apps/web/index.html`) — previously both defaulted to `"system"`, which could resolve to light on
   an OS with a light color scheme. A saved `light`, `dark`, or `system` preference is still read
   from `localStorage` and respected exactly as before (a saved `"system"` preference still tracks
   the OS setting live). No flash: the bootstrap script still sets `data-theme` synchronously before
   paint.
2. **Runtime environment robustness.** `SystemStatusPanel` (apps/web) previously constructed its
   `OmniscienceClient` at **module scope** directly from
   `import.meta.env.VITE_API_BASE_URL` / `VITE_AI_SERVICE_BASE_URL`. Since `OmniscienceClient`'s
   constructor throws if either URL is missing, an unset env var crashed the whole app during module
   evaluation — before React ever rendered — producing a blank page on every route, including
   landing and auth screens that never touch this panel. The client is now built lazily inside the
   component via a `createClient()` helper that catches the constructor error and returns `null`;
   the panel then renders a `"configuration unavailable"` status badge (tone `down`) instead of
   attempting a health check. A real network/HTTP failure still renders `"unreachable"` as before —
   the two states are distinguished. `.env.example` already documented `VITE_API_BASE_URL` /
   `VITE_AI_SERVICE_BASE_URL` correctly; no changes were needed there. Known limitation: both health
   checks share one `OmniscienceClient`, so if only one of the two URLs is missing, both badges show
   `configuration unavailable` (the constructor requires both) rather than one `configuration
   unavailable` and one real health check.
3. **Favicon.** Added `apps/web/public/favicon.svg` (vector, brand gradient purple→cyan ring on the
   dark `--omni-color-bg`) and a rasterized multi-size `apps/web/public/favicon.ico` (16/32/48px)
   fallback, referenced from `apps/web/index.html` via `<link rel="icon">` /
   `<link rel="alternate icon">`. Verified via a production `vite build` + `vite preview` that
   `/favicon.ico` now returns `200` instead of `404`.
4. **Auth card sizing.** Reviewed `apps/web/src/pages/auth/AuthLayout.tsx`, which every auth screen
   (Login, Register, Verify OTP, Forgot Password, Reset Password) renders through. Its `GlassCard`
   was already sized at `width: min(420px, 100%)` — at the top of the requested ~400–420px target —
   so no code change was made for this item; narrowing/widening further was judged unnecessary and
   out of scope for a "slight increase" once already at spec.

Focused tests were added for items 1 and 2 (`ThemeProvider.test.tsx`,
`themeBootstrapScript.test.ts`, `SystemStatusPanel.configError.test.tsx`,
`App.configError.test.tsx`); see the top-level polish summary for the full list. All of
`packages/ui` (73 tests) and `apps/web` (20 tests) pass, and both packages typecheck, lint, and
build cleanly — actually executed in this pass, not assumed.

---

# Phase 2 — Authentication & Users

Status: **In progress** — Step 1 of 8 complete, awaiting explicit approval before Step 2.

Approved decisions (from the Phase 2 implementation prompt): Prisma ORM, Argon2 password
hashing, OTP + refresh tokens in Redis, JWT access (15m) / refresh (7d) tokens,
`@nestjs/throttler` for rate limiting, production-ready SMTP with a console-log fallback when
unconfigured. Implemented in 8 sequential steps, each requiring explicit sign-off before the next
begins.

## Step 1 — Prisma, PostgreSQL, Redis, configuration, and infrastructure setup (complete)

- Added Prisma configuration foundation (`apps/api/prisma/schema.prisma`): datasource + generator
  only, reusing `POSTGRES_URL` (no separate `DATABASE_URL`) — no data models yet, those are Step 2.
  **`PrismaService`/`PrismaModule` are deferred to Step 2** (see "Step 1 fix" below) — Step 1 ships
  only the static schema file, not a wired Prisma client.
- Added `RedisService`/`RedisModule` (`apps/api/src/redis/`): a single shared ioredis client
  (connect/disconnect lifecycle, error logging); no OTP/session key logic yet — that's Step 3/4.
- Added `MailService`/`MailModule` (`apps/api/src/mail/`): generic `sendMail()` over nodemailer;
  falls back to logging the message via the shared logger (not the raw console) when
  `SMTP_HOST` is unset. No OTP templates yet — that's Step 3.
- Added `ConfigModule` (`apps/api/src/config/`): validates env once and exposes it (`ENV`) plus a
  shared pino logger (`LOGGER`) via DI tokens, so Redis/Mail (and the future Prisma/Auth modules)
  read configuration the same validated way instead of touching `process.env` directly.
- Extended `packages/config`'s env schema: `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (required,
  ≥32 chars), `JWT_ACCESS_TTL_SECONDS`/`JWT_REFRESH_TTL_SECONDS` (default 900/604800), and
  `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`/`SMTP_SECURE` (optional but
  all-or-nothing — set one and the rest become required), plus an `isSmtpConfigured()` helper.
- `apps/api/src/app.module.ts` now imports `ConfigModule`, `RedisModule`, `MailModule` alongside
  the existing `HealthModule` (additive only; Phase 0 health behavior unchanged).
- `.env.example` updated with the new JWT/SMTP variables and guidance.

### Step 1 fix (found by local verification)

Local verification ran `pnpm --filter @omniscience/api run db:generate` and it failed:
`prisma generate` exits non-zero against a model-less schema ("You don't have any models defined
in your schema.prisma, so nothing will be generated"). The original Step 1 draft had required
`db:generate` to succeed while also mandating zero models until Step 2 — a direct contradiction,
since Prisma cannot produce a client without at least one model.

Resolution (no placeholder/dummy models added):
- `PrismaService` and `PrismaModule` (which `extends PrismaClient`) were **removed from Step 1**
  and deferred to Step 2, since they cannot validly build/typecheck against an ungenerated
  `@prisma/client` — generation itself is what's blocked.
- `apps/api/src/app.module.ts` no longer imports a Prisma module.
- `apps/api/prisma/schema.prisma` remains (the approved datasource/generator configuration) with
  an explicit comment: running `prisma generate`/`migrate` against it is expected to fail until
  Step 2 adds the `User` model — that's normal Prisma CLI behavior, not a defect.
- `apps/api/package.json`'s `db:generate`/`db:migrate*`/`db:studio` scripts are left in place
  (they'll work once Step 2 adds a model) but are **not** part of Step 1's verification commands.
- Step 1 verification therefore covers install/build/lint/typecheck/test only; Prisma
  client generation and migrations are verified starting in Step 2.

### Step 1 fix — e2e test infrastructure

Local `pnpm test` then surfaced a second, separate issue in the pre-existing Phase 0
`apps/api/test/health.e2e-spec.ts`: it boots the real `AppModule`, and `AppModule` now pulls in
`ConfigModule` (Step 1), which validates the full environment — including `POSTGRES_URL`,
`MONGO_URL`, `REDIS_URL`, `QDRANT_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — none of which
are set in the test process. Bootstrap threw inside `beforeAll`, so `app` was never assigned, and
the unguarded `afterAll(() => app.close())` then threw its own `Cannot read properties of
undefined` on top of the original failure.

Fixed without weakening any production validation and without making any env variable optional:
- `Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ENV).useValue(testEnv)` —
  `testEnv` is a fully valid, correctly-typed `Env` object (same shape the real schema produces,
  including 32+ character JWT secrets), just override with test values. `packages/config`'s
  `envSchema` is never bypassed or loosened; this only swaps what `ENV` resolves to inside this
  one test's DI container.
- `.overrideProvider(RedisService).useValue(new FakeRedisService())` — a no-op stand-in
  (`onModuleInit`/`onModuleDestroy` are no-ops, `getClient()` returns a stub) so this health-only
  smoke test never dials a real Redis instance. Production continues to use the real
  `RedisService` untouched; only the test's module graph substitutes it. (No Prisma override is
  needed yet since `PrismaService` isn't wired into `AppModule` until Step 2.)
- `let app: INestApplication | undefined` plus `afterAll(async () => { if (app) { await
  app.close(); } })` — `app.close()` now only runs if `app.init()` actually succeeded.
- The existing assertions (`GET /health` → 200 + `status: "ok"`/`service: "api"`, and
  `GET /unknown-route` → 404 `ApiError` envelope) are unchanged.

### Known limitations (Step 1)

- Same environment constraint as Phase 1: no network egress to the npm registry here, so
  `pnpm install` has **not** been run, and the new dependencies (`@prisma/client`, `prisma`,
  `ioredis`, `nodemailer`, `@types/nodemailer`, `dotenv-cli`) are declared in `package.json` but
  not installed. `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm typecheck` have **not** been
  executed in this environment — they must be run locally. Everything above reflects careful
  manual code review, not a tool run.
- `apps/api`'s Prisma CLI scripts (`db:migrate`, `db:migrate:deploy`, `db:studio`) load the repo
  root `.env` via `dotenv-cli` since Prisma's own `.env` auto-discovery only looks in
  `apps/api/prisma/` or `apps/api/`, not the repo root where this monorepo's single `.env` lives.
  They cannot be run meaningfully until Step 2 adds a model (see "Step 1 fix" above).
- `MailService`'s console-log fallback activates whenever `SMTP_HOST` is unset, in any
  `NODE_ENV` — this is the approved behavior, but it means a production deployment that forgets
  to set SMTP variables will silently log OTPs instead of emailing them rather than failing
  loudly. Worth a deployment-checklist reminder in a later step.

## Step 2 — User model, auth module foundation, password hashing, and validation (complete)

- Added the `User` model to `apps/api/prisma/schema.prisma`: `id` (`cuid()`, string — not an
  auto-incrementing integer), `email` (`@unique`), `passwordHash`, `name` (matches the Phase 1
  RegisterPage "Full name" field), `emailVerifiedAt` (nullable `DateTime`, set by Step 3's OTP
  flow), `createdAt`/`updatedAt`. No OTP, refresh-token, workspace, billing, or profile fields —
  out of Step 2's approved scope.
- Added the first migration: `apps/api/prisma/migrations/20260712000000_create_users_table/` +
  `migrations/migration_lock.toml`. **Hand-authored**, not CLI-generated — see "Known
  limitations" below.
- Restored `PrismaService`/`PrismaModule` (deferred in Step 1 because `prisma generate` requires
  at least one model) — unchanged from the Step 1 draft otherwise: connect/disconnect wired to
  Nest's module lifecycle, warn/error events routed through the shared logger.
- Added `apps/api/src/auth/`: `AuthModule` (wires only `PasswordHasherService` — no controller,
  since there's nothing to expose until Step 3/4) and `PasswordHasherService` (Argon2id `hash()`/
  `verify()`, tuned parameters centralized in one place, never logs plaintext or hashes,
  `verify()` normalizes a malformed/foreign hash to `false` instead of throwing).
- Added `packages/schemas/src/auth.ts`: shared `emailSchema` (trims + lowercases, so `User.email`'s
  plain `@unique` index is sufficient without a Postgres `citext` extension), `passwordSchema`
  (10–128 chars, requires lower/upper/digit/special), `displayNameSchema` (2–100 chars, trimmed) —
  single source of truth for both `apps/api` and (in a later step) `apps/web`.
- Added `apps/api/src/common/pipes/zod-validation.pipe.ts`: a generic, reusable Nest pipe that
  validates any request payload against a shared Zod schema, throwing a structured
  `BadRequestException` (`code`, `message`, per-field `details` — never the offending value) on
  failure. Not wired to any endpoint yet (Step 3/4 will use it with `@Body(new
  ZodValidationPipe(someSchema))`).
- Extended `AllExceptionsFilter` (Phase 0 file) additively: it now prefers a structured
  exception body's own `code`/`details` (e.g. `ZodValidationPipe`'s `"VALIDATION_ERROR"`) over the
  generic HTTP-status-derived code, when present. Every exception without a structured body
  (all of Phase 0/1's) keeps the exact previous behavior — covered by the pre-existing tests,
  which still pass unmodified, plus one new test for the structured case.
- `apps/api/src/app.module.ts`: re-added `PrismaModule`, added `AuthModule` (additive only).
- `apps/api/test/health.e2e-spec.ts`: added a `FakePrismaService` override alongside the existing
  `FakeRedisService` one, so this health-only smoke test still doesn't require a live Postgres
  now that `PrismaModule` is back in `AppModule`.
- `apps/api/package.json`: added `argon2` and `@omniscience/schemas` dependencies.

### Known limitations (Step 2)

- Same environment constraint as Steps 0/1: no network egress here, so `pnpm install` has not
  been run and none of `pnpm build`/`lint`/`typecheck`/`test` have been executed in this
  environment. Must be run and confirmed locally.
- **The migration SQL was hand-authored, not produced by running `prisma migrate dev`** — there's
  no live Postgres or installed CLI available here. It was written to match exactly what Prisma
  generates for this schema (verified by careful manual review of Prisma's standard
  `CREATE TABLE`/`CREATE UNIQUE INDEX` output shape), but it has not been applied against a real
  database and its accuracy has not been machine-verified. Please run
  `pnpm --filter @omniscience/api run db:migrate` locally: Prisma should recognize it as already
  matching the current schema; if Prisma reports any drift or checksum mismatch instead, delete
  this migration folder and let `prisma migrate dev --name create_users_table` generate the
  authoritative one, then let me know so the checked-in migration can be replaced.
- `argon2` requires a native binding that must be compiled/installed via `pnpm install`; not
  verified to build successfully in this environment for the same no-network reason.
- No repository/service yet reads or writes a `User` row — `PrismaService` and the `User` model
  exist, but nothing calls `prisma.user.*` until Step 3 (registration) needs it.
- `ZodValidationPipe` and the shared auth schemas are not wired to any controller yet — by
  design, per Step 2's scope boundaries.

### Step 2 — local verification confirmed

Locally verified green end-to-end: `pnpm install`, `prisma validate`/`generate`, a real Docker
environment (Postgres/Redis/MongoDB/Qdrant), the first migration applied against a real
Postgres database, `pnpm build`/`lint`/`typecheck`/`test`, and GitHub Actions all passed.

One fix required: `PasswordHasherService`'s `argon2.Options & { type: argon2.ArgonType }` type
failed because installed `argon2` v0.41.x doesn't export `ArgonType`. Fixed to plain
`argon2.Options` (the `type: argon2.argon2id` value assignment itself was always fine — only the
extra type-level intersection was invalid). This fix is preserved as-is in Step 3.

## Step 3 — Registration, pending-registration flow, OTP generation, email delivery,
## verification, and resend OTP (complete)

- **`packages/config`**: added `OTP_TTL_SECONDS` (default 600), `OTP_MAX_ATTEMPTS` (default 5),
  `OTP_RESEND_COOLDOWN_SECONDS` (default 60) — all optional with production-reasonable defaults,
  consistent with the JWT TTL pattern from Step 1.
- **`packages/types/src/auth.ts`** (new): `RegisterRequest`/`Response`, `VerifyOtpRequest`/
  `Response`, `ResendOtpRequest`/`Response` — no tokens in any response; JWT issuance is Step 4.
- **`packages/schemas/src/auth.ts`**: added `otpCodeSchema` (`^\d{6}$`) and composed
  `registerRequestSchema`/`verifyOtpRequestSchema`/`resendOtpRequestSchema`, built from the
  Step 2 field-level schemas so a password-policy change still only happens in one place.
- **`apps/api/src/auth/otp.service.ts`** (new): generates 6-digit OTP codes via Node's
  `crypto.randomInt` (cryptographically secure, never `Math.random`, never a fixed/fake value).
  Single responsibility — hashing/storage live elsewhere.
- **`apps/api/src/auth/pending-registration.store.ts`** (new): Redis-backed CRUD for in-flight
  registrations, keyed `auth:pending-registration:{email}`. `save()` sets a fresh `EX` TTL
  (`OTP_TTL_SECONDS`) on register/resend; `incrementAttempts()` uses `KEEPTTL` so a wrong guess
  never extends an attacker's guessing window.
- **`apps/api/src/auth/auth.service.ts`** (new): orchestrates the full flow —
  - `register()`: rejects if a verified `User` already exists (`409 EMAIL_ALREADY_REGISTERED`);
    otherwise hashes the password (Argon2id, via the existing `PasswordHasherService` — reused
    for OTP hashing too, since a 6-digit code is a low-entropy secret already protected by Redis
    TTL + attempt limits + a resend cooldown, so a second KDF/env-secret for OTPs specifically
    would add complexity without meaningfully more security), generates+hashes the OTP, saves the
    pending registration, and emails the code via the Step 1 `MailService` (which already
    logs-instead-of-sends in dev when SMTP is unset).
  - `verifyOtp()`: 404 if no pending registration; 410 `OTP_MAX_ATTEMPTS_EXCEEDED` if attempts are
    exhausted; 410 `OTP_EXPIRED` if the code's own expiry has passed; 400 `OTP_INCORRECT` (with
    `attemptsRemaining` in `details`) on a wrong code, incrementing the attempt counter; on a
    correct code, creates the real `User` row (`emailVerifiedAt: now`) and deletes the pending
    registration. A Prisma unique-constraint race (two verifies for the same email landing
    concurrently) is caught and converted to the same `409` as the upfront check.
  - `resendOtp()`: 404 if no pending registration; re-uses the same cooldown check as `register()`
    (`429 OTP_RESEND_COOLDOWN` with `retryAfterSeconds`); otherwise issues a fresh code, resets
    attempts to 0, and re-sends.
  - No JWT/session is issued anywhere in this file — verifying only creates the account; logging
    in afterward is Step 4.
- **`apps/api/src/auth/auth.controller.ts`** (new) — the first real endpoints in `AuthModule`:
  `POST /auth/register` (202), `POST /auth/verify-otp` (201 — this is the call that actually
  creates the `User` row), `POST /auth/resend-otp` (200). Each validates its body with the Step 2
  `ZodValidationPipe` against the new composed schemas, and each carries its own `@Throttle()`
  limit on top of the new app-wide default.
- **`apps/api/src/app.module.ts`**: added `ThrottlerModule.forRoot([{ name: "default", ttl: 60_000,
  limit: 60 }])` plus a global `APP_GUARD` → `ThrottlerGuard` (per the approved Phase 2 decision to
  use `@nestjs/throttler`) — a generic per-IP safety net API-wide; the auth endpoints layer
  tighter per-route limits on top via `@Throttle()`. Uses the library's default in-memory storage
  (see known limitations).
- **`apps/api/test/health.e2e-spec.ts`**: `testEnv` fixture extended with the three new required
  `OTP_*` fields (no behavior change).
- **`apps/api/test/auth-registration.e2e-spec.ts`** (new): exercises the real HTTP surface —
  register → wrong OTP (400) → correct OTP (201) → duplicate-email re-register (409) →
  malformed-payload validation (400 with structured `details`) — against in-memory Prisma/Redis
  fakes and a mail-capturing fake, so it needs no live infrastructure.
- **`apps/api/package.json`**: added `@nestjs/throttler`.

### Architectural decisions worth calling out

- **OTP hashing reuses `PasswordHasherService`** rather than introducing a second hashing
  primitive/secret. Both password and OTP hashes are Argon2id — the same well-reviewed code path,
  no new env var, no new dependency. Given OTPs are already short-lived (Redis TTL), attempt-limited,
  and resend-cooldown-protected, this is a reasonable security/complexity tradeoff.
- **Pending registrations live only in Redis**, never in Postgres, per the original Phase 2
  decision — a `User` row is created exactly once, only after verification succeeds.
- **`AuthService` never issues a token.** Verifying an OTP creates the account; it does not log
  the person in. This keeps Step 3 strictly scoped and Step 4 (login/JWT) a clean addition on top.
- **Rate limiting is layered**: `AuthService`'s resend cooldown is a per-email business rule
  (works correctly even behind a shared NAT/proxy); `ThrottlerGuard` is a per-IP infrastructure
  rule (works even if someone rotates through many different emails). Neither alone is sufficient.

### New dependencies

- `@nestjs/throttler` (apps/api) — rate limiting, per the approved Phase 2 decision.
  (`argon2` and `@omniscience/schemas` were already added in Step 2; no change there.)

### Known limitations (Step 3)

- No install/build/lint/typecheck/test has been executed in this session for these new changes —
  only Step 1 and Step 2 have been locally verified so far, per your reports. Please run the
  verification commands below before approving.
- `ThrottlerModule` uses the library's default **in-memory** storage. This is fine for a single
  API instance but does not share rate-limit counters across multiple instances/replicas — a
  future step should back it with Redis (`@nestjs/throttler`'s storage adapter) if/when the API is
  horizontally scaled.
- The OTP resend cooldown and max-attempts values are process-wide defaults
  (`OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_ATTEMPTS`); there's no per-user override or admin
  unlock mechanism yet — not required by the approved scope, but worth knowing operationally.
- No login endpoint exists yet, so a verified account cannot be used for anything until Step 4.
- No forgot/reset-password flow yet — Step 5.
- `apps/api/test/auth-registration.e2e-spec.ts`'s fakes are intentionally minimal (only the
  surface `AuthService`/`PendingRegistrationStore` call) — they are not a substitute for testing
  against a real Postgres/Redis, which is covered by your local Docker-based verification instead.

## Step 3 — Production-readiness blocker fixes (complete, locally verified)

A senior-engineer review of the Step 3 implementation above identified three production
blockers. All three are fixed; nothing else in Step 3 (or earlier steps) was touched, and Step 4
was not started.

### Blocker 1 — Stale lockfile

`apps/api/package.json` added `@nestjs/throttler` in Step 3 but `pnpm-lock.yaml` was never
regenerated. Ran `pnpm install` at the repo root to regenerate it. Verified
`pnpm install --frozen-lockfile` succeeds from a clean `node_modules` (see Commands actually
executed, below) — this is also now enforced every run by the `redis` service container job in
CI, which starts from a fresh checkout.

### Blocker 2 — Plaintext OTPs could reach production logs

Previously, `MailService` fell back to `logger.warn`-ing the complete email body (including the
raw OTP) any time SMTP was unconfigured, in every environment including production.

Fixed in two layers:

- **`packages/config/src/env.ts`**: `envSchema`'s `superRefine` now adds a validation issue on
  `SMTP_HOST` if `NODE_ENV === "production"` and no `SMTP_*` variable is set. `loadEnv()` (called
  once, at API startup, before the Nest app is created) throws in that case — the process never
  finishes booting, so a production deployment without SMTP fails fast and loudly instead of
  silently falling back to console-logging OTPs. Development and test are unaffected: SMTP stays
  optional there, exactly as before.
- **`apps/api/src/mail/mail.service.ts`**: `sendMail()`'s "SMTP not configured" branch now checks
  `NODE_ENV`. In development/test it still logs the full message (unchanged — this is what lets a
  developer read an OTP without a working SMTP server). In production it never logs the body; it
  throws instead. This branch is defense-in-depth only — the `packages/config` fix above means
  `this.transporter` is already guaranteed non-null in production — but it means even a future bug
  that bypassed environment validation still couldn't cause a plaintext OTP to reach production
  logs.

### Blocker 3 — Redis read-modify-write races in `PendingRegistrationStore`

Previously, `incrementAttempts()` and the register/resend cooldown check were separate
`GET`-then-`SET` round trips from Node, each racy under concurrent requests for the same email:
two simultaneous wrong-OTP guesses could both read `otpAttempts = N` and both write back `N + 1`,
losing an increment and letting `OTP_MAX_ATTEMPTS` be bypassed; two simultaneous
register/resend calls could both read "cooldown elapsed" and both send an OTP email.

Fixed by replacing every read-then-decide-then-write sequence with a single Redis `EVAL` (Lua
script), which Redis executes atomically — no other command can interleave between the script's
read and its write, regardless of how many requests arrive concurrently.

- **`apps/api/src/auth/pending-registration.store.ts`** (rewritten): `save()` +
  `incrementAttempts()` are replaced by `claimSend()` and `recordFailedAttempt()`.
  - `claimSend(email, record)` — one Lua script (`CLAIM_SEND_SCRIPT`) that atomically checks the
    resend cooldown against whatever is currently stored (if anything) and, only if the cooldown
    has elapsed, `SET`s the new record with a fresh `OTP_TTL_SECONDS` `EX`. Returns
    `{status: "OK"}` or `{status: "COOLDOWN", retryAfterSeconds}`. Used by both `register()` and
    `resendOtp()` — both start a new OTP lifecycle and both must respect the same cooldown.
  - `recordFailedAttempt(email)` — one Lua script (`RECORD_FAILED_ATTEMPT_SCRIPT`) that atomically
    re-reads the record inside Redis, checks expiry and `OTP_MAX_ATTEMPTS`, and either increments
    `otpAttempts` with `KEEPTTL` (never a fresh `EX` — a wrong guess never extends the guessing
    window) or deletes the key once the limit is hit. Returns one of `NOT_FOUND` / `EXPIRED` /
    `MAX_ATTEMPTS_EXCEEDED` / `{status: "INCREMENTED", attemptsRemaining}`.
  - Both scripts do their date math on epoch-millisecond fields (`otpExpiresAtMs`,
    `lastOtpSentAtMs`) mirrored alongside the existing ISO-string fields in the stored JSON, since
    Redis's embedded Lua has no date parser. `get()` strips these internal fields back out before
    returning a `PendingRegistrationRecord` to callers, so the public shape is unchanged.
- **`apps/api/src/auth/auth.service.ts`**: `register()` and `resendOtp()` now call `claimSend()`
  and throw the standard `429 OTP_RESEND_COOLDOWN` (with `retryAfterSeconds` taken from the atomic
  result) if the claim reports `COOLDOWN` — the email is only sent after a successful claim, so a
  losing racer can never trigger a send. `verifyOtp()`'s wrong-code branch now calls
  `recordFailedAttempt()` and maps its atomic result to the appropriate response
  (`OTP_INCORRECT` / `OTP_EXPIRED` / `OTP_MAX_ATTEMPTS_EXCEEDED` / `PENDING_REGISTRATION_NOT_FOUND`)
  — the attempt count and limit decision are never taken from the earlier, potentially-stale
  `get()` read, per the requirement that AuthService consume the atomic Redis result rather than
  recompute security-sensitive state itself. The upfront "is this already expired / already at the
  limit" checks in `verifyOtp()` (before even attempting hash verification) still use the initial
  `get()` snapshot — that's an intentional fast-path for a clean error message and was already
  buffered against by `otpExpiresAt` being "slightly earlier-or-equal" than the Redis key's own
  TTL; the atomic script is the sole authority once a *wrong* guess needs its attempt recorded.

### Tests added

- **`apps/api/src/auth/pending-registration.store.spec.ts`** (rewritten): unit tests against a
  mocked `ioredis.eval`, covering both scripts' return-value parsing (`OK`/`COOLDOWN`,
  `NOT_FOUND`/`EXPIRED`/`MAX_ATTEMPTS_EXCEEDED`/`INCREMENTED`) and the arguments each script is
  invoked with.
- **`apps/api/src/auth/pending-registration.store.concurrency.spec.ts`** (new): runs genuinely
  concurrent operations (`Promise.all` of 20–50 simultaneous calls) against a **real Redis**
  instance — a mocked client cannot prove atomicity, since a mock has no concurrency semantics of
  its own. Proves:
  - simultaneous failed OTP attempts never lose an increment (exactly 4 `INCREMENTED` results with
    distinct `attemptsRemaining` values, exactly 1 `MAX_ATTEMPTS_EXCEEDED`, out of 20 concurrent
    calls against `OTP_MAX_ATTEMPTS = 5`);
  - `OTP_MAX_ATTEMPTS` cannot be bypassed by 50 concurrent guesses;
  - a failed attempt preserves the record's TTL exactly (never extends it, verified by lowering the
    TTL first and asserting it only ever decreases);
  - simultaneous resend claims cannot both succeed within the cooldown (exactly 1 `OK` out of 20
    concurrent claims for the same email).
  Requires `REDIS_URL` (or a local Redis on `redis://localhost:6379`); skips its assertions with a
  console warning if none is reachable, so `pnpm test` still passes for a contributor without local
  Redis. CI now provides one — see `.github/workflows/ci.yml`.
- **`apps/api/src/mail/mail.service.spec.ts`**: added a `NODE_ENV: "production"` case asserting
  `sendMail()` rejects and that neither `logger.warn` nor `logger.error` is ever called with the
  plaintext OTP.
- **`packages/config/src/env.test.ts`**: added cases for the new production-mandatory SMTP rule
  (allowed unconfigured in development/test; throws in production when unset; succeeds in
  production once fully configured).
- **`apps/api/src/auth/auth.service.spec.ts`**: updated for the new `claimSend`/
  `recordFailedAttempt` contract, including a case proving `register()`/`resendOtp()` never call
  `mail.sendMail()` when the atomic claim reports a cooldown.
- **`apps/api/test/auth-registration.e2e-spec.ts`**: its in-memory fake Redis client now
  implements `EVAL` for both scripts (dispatched on a `-- SCRIPT: ...` marker comment each script
  starts with) so the existing HTTP-level test continues to exercise the real `AuthService` code
  path without requiring live Redis. This fake is single-request-at-a-time (supertest doesn't fire
  concurrent requests), so it verifies *logic*, not atomicity — atomicity is what the real-Redis
  concurrency spec above proves.

### Dependencies changed

- `apps/api/package.json` — no new dependency added by these fixes (`@nestjs/throttler` was
  already added in the Step 3 implementation this review covered; only its lockfile entry was
  stale — see Blocker 1).
- `pnpm-lock.yaml` — regenerated at the repo root via `pnpm install`.

### Commands actually executed (this session)

```
npm install -g pnpm@9.12.0
pnpm install --no-frozen-lockfile        # regenerates pnpm-lock.yaml (Blocker 1)
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install --frozen-lockfile           # verifies the regenerated lockfile installs cleanly
apt-get install -y redis-server          # local Redis for the concurrency spec + manual checks
redis-server --daemonize yes --port 6379
pnpm build                               # turbo build, all 9 packages — succeeded
pnpm lint                                # turbo lint, all 9 packages — succeeded (1 unused-import
                                          # fix applied to pending-registration.store.spec.ts)
pnpm typecheck                           # turbo typecheck, all 9 packages — succeeded
REDIS_URL=redis://localhost:6379 pnpm test   # turbo test, all 9 packages — succeeded
                                              # (@omniscience/api: 17 suites / 72 tests passed,
                                              # including the 4 real-Redis concurrency tests)
```

`prisma migrate`/a live Postgres were not exercised in this session — nothing in these three
blocker fixes touches the Prisma schema or migrations (Blocker 1 is a lockfile-only dependency
change; Blockers 2–3 are `packages/config`, `MailService`, and `PendingRegistrationStore` only).
Step 2's already-verified migration is unaffected.

### Honest build/test status

Build ✅ · Lint ✅ · Typecheck ✅ · Test ✅ (72/72 in `@omniscience/api`, including 4 tests against
a real Redis instance; 18/18 in `@omniscience/config`; full monorepo `pnpm build`/`lint`/
`typecheck`/`test` all green via `turbo`). GitHub Actions has **not** run yet for this change —
the CI workflow was updated to add a `redis` service container (required for the new concurrency
spec to run for real instead of skipping) and needs to actually execute on your end to be
confirmed green, per your locked workflow.

### Known limitations (Step 3 blocker fixes)

- The real-Redis concurrency spec self-skips its assertions (passes trivially) if no Redis is
  reachable, rather than failing the build — this keeps `pnpm test` usable without local infra, but
  means a contributor who never sees a Redis-backed CI run locally won't get a failure signal if
  they accidentally break atomicity. CI's new `redis` service container is the backstop.
- `claimSend()`'s cooldown check reads whatever record currently exists at call time; if a pending
  registration is deleted (e.g. verified successfully) in the moment between `resendOtp()`'s
  existence check and its `claimSend()` call, the resend will still succeed and create a fresh
  pending registration from the (now slightly stale) data read earlier — a narrow, non-security-
  relevant edge case, not the race this blocker fix targets.
- `ThrottlerModule` in-memory storage limitation from the original Step 3 entry above still stands
  — unrelated to these three blockers, unchanged.
- No login endpoint exists yet (Step 4, not started).

# Step 4 — Login, JWT access/refresh tokens, refresh, logout, and `/auth/me` (complete)

Scope determined from `docs/02_SRS.md`'s Authentication requirement ("… normal login after
verification … JWT access/refresh tokens …"), the approved Phase 2 decisions recorded above
("JWT access (15m)/refresh (7d) tokens", "OTP + refresh tokens in Redis"), and
`packages/types/src/auth.ts`'s Step 3 docstring ("JWT issuance (login) is Step 4"). Confirmed via
`packages/config/src/env.ts` that `JWT_ACCESS_SECRET`/`JWT_ACCESS_TTL_SECONDS`/
`JWT_REFRESH_TTL_SECONDS` were already provisioned in Step 1 specifically for this step.
`apps/web/src/pages/LoginPage.tsx` and `RegisterPage.tsx` remain UI-only previews — Step 3 set the
precedent that a step builds the backend without wiring the existing Phase 1 frontend pages to it,
so Step 4 follows the same precedent. No frontend wiring in this step.

Strict scope (per the task that requested Step 4): login, JWT issuance, refresh, logout. Forgot
password, password reset, full user-profile management, and session/device management are
explicitly deferred to a later step.

## What was added

- **`POST /auth/login`** — `{ email, password }` → `{ accessToken, accessTokenExpiresInSeconds,
  refreshToken, refreshTokenExpiresInSeconds, user: { id, email, name } }`. Rejects with
  `401 INVALID_CREDENTIALS` for either an unknown email or a wrong password (same generic error
  and message for both, so a caller can't enumerate registered emails), or `403
  EMAIL_NOT_VERIFIED` if the account exists but `emailVerifiedAt` is null (currently unreachable
  through the public API — see known limitations — but real defense-in-depth against a future
  account-creation path that could produce an unverified `User` row).
- **`POST /auth/refresh`** — `{ refreshToken }` → same shape as login minus `user`. The refresh
  token is single-use: this call atomically consumes it and issues a brand-new access token *and*
  a brand-new refresh token (rotation). Presenting an already-used, unknown, or expired token
  returns `401 REFRESH_TOKEN_INVALID`.
- **`POST /auth/logout`** — `{ refreshToken }` → `{ loggedOut: true }`. Revokes the refresh token
  so it can never be used again. Always succeeds (idempotent — revoking an already-invalid token
  is a no-op), so it never leaks whether the token it was given was valid.
- **`GET /auth/me`** — behind `JwtAuthGuard` (`Authorization: Bearer <accessToken>`) → the caller's
  `{ id, email, name }`. The only protected route in the codebase so far; exists to prove the guard
  works end-to-end and give the frontend a cheap "am I still logged in" check, not as general
  profile management.

## Architecture

- **`AccessTokenService`** (`apps/api/src/auth/access-token.service.ts`) — the only place that
  touches `@nestjs/jwt` directly (one focused service per primitive, matching
  `PasswordHasherService`/`OtpService`'s existing convention). `AuthModule` registers `JwtModule`
  via `JwtModule.registerAsync({ inject: [ENV], useFactory: ... })` so the secret/TTL come from the
  already-validated `Env`, never `process.env` directly. `verify()` never throws — malformed,
  expired, or wrong-signature tokens all just return `null`, which `JwtAuthGuard` turns into a
  generic `401`.
- **`RefreshTokenStore`** (`apps/api/src/auth/refresh-token.store.ts`) — refresh tokens live only
  in Redis, never Postgres (same approved-decision pattern as OTPs in Step 3). A token is
  `${tokenId}.${secret}`: `tokenId` is a `randomUUID()` used as the Redis key (safe to expose —
  carries no secrecy on its own), `secret` is a separate high-entropy random value whose Argon2id
  hash (via the existing `PasswordHasherService` — reused rather than adding a second hashing
  primitive, same reasoning as OTP hashing) is the only thing ever stored. `issue()` writes a new
  record with a fresh TTL; `consume()` is single-use and atomic via Redis `GETDEL` (read-and-delete
  as one command, wrapped in a tiny Lua script tagged with a `-- SCRIPT: refresh-token-consume`
  marker, following the same atomic-Redis-op pattern the Step 3 blocker fix established for
  `PendingRegistrationStore` — see that file's docstring); `revoke()` is a plain `DEL`, idempotent
  by design.
- **`JwtAuthGuard`** (`apps/api/src/auth/jwt-auth.guard.ts`) — hand-rolled rather than pulling in
  `@nestjs/passport` + `passport-jwt`: the check is "extract Bearer token, verify, attach payload",
  a single step that doesn't justify a dependency and its strategy-registration boilerplate —
  consistent with `ZodValidationPipe` already being hand-rolled instead of `nestjs-zod`. Always
  throws the same generic `401 UNAUTHORIZED` regardless of *why* the token failed. Exported from
  `AuthModule` (alongside `AccessTokenService`) so a future module can protect its own routes with
  the same guard without re-implementing JWT verification.
- **`CurrentUser`** (`apps/api/src/auth/current-user.decorator.ts`) — thin `createParamDecorator`
  pulling `request.user` (set by `JwtAuthGuard`) into a controller method parameter.
- **`AuthService.login/refresh/logout/getCurrentUser`** — `login()` calls
  `passwordHasher.verify()` against `DUMMY_HASH` (a precomputed, syntactically valid Argon2id hash
  of an unrelated password) when no account exists for the given email, so a nonexistent-account
  response and a wrong-password response take roughly the same amount of time — returning the same
  generic error message alone doesn't prevent email enumeration if one path is measurably faster.
  `refresh()` re-checks the user still exists after consuming the token (an account could have been
  deleted after the token was issued) before issuing new tokens. All four methods return/throw
  through the same `ApiSuccess`/structured-exception contract Step 3 established.

## Security notes

- Access tokens are stateless JWTs and therefore cannot be revoked before they expire — `logout()`
  only revokes the refresh token. With the default 15-minute `JWT_ACCESS_TTL_SECONDS`, a logged-out
  access token remains technically valid for up to 15 more minutes. This is a standard, accepted
  tradeoff for short-lived access tokens (see known limitations) rather than an oversight.
  `JWT_REFRESH_SECRET` (provisioned in Step 1) is intentionally **not used** by this step — refresh
  tokens are opaque, Redis-backed, single-use secrets rather than JWTs, so there's nothing for it
  to sign; it remains reserved/validated in `packages/config` in case a future phase needs a signed
  refresh-token format.
- Refresh-token rotation (Blocker-3-style atomicity): `consume()`'s `GETDEL` means a refresh token
  can be exchanged exactly once, even under concurrent requests for the same token — proven against
  a real Redis instance in `refresh-token.store.concurrency.spec.ts`, not just asserted.
- No reuse-detection "token family" revocation: if a refresh token is stolen and used by an
  attacker before the legitimate client rotates it, only that one exchange is prevented on replay —
  the attacker's newly-rotated token is still valid, and the legitimate client's next refresh
  attempt with the now-stale token will itself fail with `REFRESH_TOKEN_INVALID` (indistinguishable
  from an ordinary expired/already-used token). Full OAuth-style family-wide revocation-on-reuse
  was judged out of scope for this step (see known limitations) but is a natural Step-4.x/Step-5
  hardening candidate.
- `login()`'s `EMAIL_NOT_VERIFIED` check is currently unreachable through the public API (see known
  limitations) but is kept as defense-in-depth, exercised directly in `auth.service.spec.ts`.

## Dependencies changed

- `apps/api/package.json` — added `@nestjs/jwt@^10.2.0` (the only new dependency; wraps
  `jsonwebtoken`, already a transitive dependency of the NestJS ecosystem). No `@nestjs/passport`/
  `passport-jwt` — see `JwtAuthGuard` above for why.
- `pnpm-lock.yaml` — regenerated via `pnpm install` (never hand-edited).

## Tests added

- **`access-token.service.spec.ts`** — sign→verify round-trip; malformed, wrong-secret, and
  expired tokens all resolve to `null` rather than throwing; TTL is exposed correctly.
- **`jwt-auth.guard.spec.ts`** — allows a valid Bearer token and attaches `req.user`; rejects a
  missing header, a non-Bearer scheme, an empty Bearer value, and a token that fails verification —
  all as the same generic `401`.
- **`refresh-token.store.spec.ts`** — unit tests against a mocked `ioredis.eval`/`set`/`del`:
  `issue()` stores a hashed secret (never the raw secret) with the right TTL; `consume()` parses
  the token, calls the atomic script, verifies the secret hash, and returns `NOT_FOUND` for a
  missing record, a hash mismatch, or a malformed token (without even calling Redis for the last
  case); `revoke()` deletes by `tokenId` and no-ops for a malformed token.
- **`refresh-token.store.concurrency.spec.ts`** (real Redis, same pattern as
  `pending-registration.store.concurrency.spec.ts`) — 20 concurrent `consume()` calls for the same
  token: exactly 1 succeeds, the other 19 (including a direct two-call replay test) get
  `NOT_FOUND` — proving the `GETDEL`-based single-use guarantee under genuine contention, not just
  asserting it.
- **`auth.service.spec.ts`** (extended) — `login()` covers success, unknown email (asserting
  `verify()` is still called against a dummy hash), wrong password, and unverified email;
  `refresh()` covers rotation success, an invalid/unknown token, and a token whose user no longer
  exists; `logout()` always reports success; `getCurrentUser()` covers found and
  no-longer-exists.
- **`auth.controller.spec.ts`** (extended) — one delegation test per new endpoint, asserting the
  `ApiSuccess` envelope; `JwtAuthGuard` is overridden with a stub so these tests exercise the
  controller method directly without needing a real token.
- **`auth.module.spec.ts`** (extended) — asserts `AccessTokenService`, `RefreshTokenStore`, and
  `JwtAuthGuard` all resolve from the compiled module alongside the existing Step 2/3 providers.
- **`test/auth-registration.e2e-spec.ts`** (extended, real HTTP via supertest) — full
  login→/auth/me→refresh(rotation, including a same-token replay rejection)→logout(then a
  refresh-with-the-revoked-token rejection) flow reusing the user registered/verified by the file's
  first test; plus wrong-password, unknown-email, unverified-email (see known limitations for what
  this actually proves), missing-Authorization-header, garbage-bearer-token, and malformed-login-
  payload rejections. The in-memory fake Redis client gained a third `EVAL` case (dispatched on the
  `-- SCRIPT: refresh-token-consume` marker) implementing plain read-and-delete — sufficient for a
  single-request-at-a-time HTTP test; the fake Prisma's `findUnique` was extended to also match by
  `id` (Step 4 looks users up by `id` from the token's `sub` claim, where Step 3 only ever looked up
  by `email`).

## Commands actually executed (this session)

```
npm install -g pnpm@9.12.0                                     # pnpm was not yet on PATH
pnpm install --no-frozen-lockfile        # regenerates pnpm-lock.yaml for @nestjs/jwt
redis-server --daemonize yes --port 6379 --save "" --appendonly no
pnpm build                               # turbo build, all 9 packages — succeeded
pnpm lint                                # turbo lint,  all 9 packages — succeeded
pnpm typecheck                           # turbo typecheck, all 9 packages — succeeded
REDIS_URL=redis://localhost:6379 pnpm test   # turbo test, all 9 packages — succeeded
                                              # (@omniscience/api: 21 suites / 116 tests passed,
                                              # including the 2 real-Redis refresh-token
                                              # concurrency tests)
```

`prisma generate`'s query-engine download (`binaries.prisma.sh`) is not reachable from this
sandbox's network egress allowlist. To still get a genuine `tsc`/`jest` run against a realistic
`PrismaClient` shape rather than skipping verification, a local-only stub matching the exact
`User`-model surface `PrismaService`/`AuthService` use (`findUnique`, `create`, `$connect`,
`$disconnect`, `$on`) was placed at the pnpm-store path `@prisma/client` resolves to
(`node_modules/.pnpm/@prisma+client@5.22.0_.../node_modules/.prisma/client/`), clearly marked as a
sandbox-only artifact and excluded from the delivered ZIP. This is a verification aid only, not a
code change — your local `pnpm install` (with real internet access) produces the real generated
client and is unaffected by any of this.

## Honest build/test status

Build ✅ · Lint ✅ · Typecheck ✅ · Test ✅ (`@omniscience/api`: 21/21 suites, 116/116 tests,
including 2 tests against a real Redis instance for refresh-token rotation; full monorepo
`pnpm build`/`lint`/`typecheck`/`test` all green via `turbo`, 15/15 tasks). GitHub Actions has
**not** run yet for this change — needs to execute on your end to be confirmed green, per your
locked workflow.

## Known limitations (Step 4)

- **No refresh-token-family reuse detection.** A stolen-and-replayed refresh token is only
  rejected on its *second* use (once the legitimate client or the attacker has already rotated it
  once) — see Security notes above. Real-world impact is limited by the 7-day TTL and single-use
  rotation, but full family-wide revocation-on-reuse (OAuth-style) is not implemented.
- **Access tokens can't be revoked early.** `logout()` only revokes the refresh token; a stolen
  access token remains valid until its own (short, 15-minute-default) expiry. Standard tradeoff for
  stateless JWTs, not a bug.
- **`EMAIL_NOT_VERIFIED` is currently unreachable through the public API.** Every `User` row today
  is created by `verifyOtp()` with `emailVerifiedAt` already set — there's no route yet that
  produces an unverified `User` row. The check is still correct and tested directly at the unit
  level; the e2e spec documents (in its test name and a comment) that a merely-pending
  registration is indistinguishable from an unknown email at the login endpoint, and asserts the
  actually-reachable behavior (`INVALID_CREDENTIALS`) instead.
- **No per-account login lockout.** Only the existing per-IP `@Throttle` rate limiting (in-memory,
  same limitation already logged in Step 3) guards `/auth/login` and `/auth/refresh` against
  brute-force/credential-stuffing; there is no additional per-account attempt counter or lockout
  (not required by the approved scope for this step).
- **`JWT_REFRESH_SECRET` is provisioned but unused** by design — see Security notes above.
- No forgot-password/password-reset, user-profile, or session/device-management endpoints yet
  (later steps). No frontend wiring — `LoginPage.tsx`/`RegisterPage.tsx` remain UI-only previews,
  matching the precedent Step 3 set.
