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
