# Project State

## Completed

Vision, core SRS, product design, architecture, hybrid storage, AI coverage matrix, roadmap and
Claude rules. Phase 0 — Foundation. Phase 1 — Premium UI Foundation (design system, theme/motion
systems, adaptive background, responsive app shell, landing page, UI-only auth screens, full
reusable component library in `@omniscience/ui`).

## Current

Phase 1 is complete (see prior entry below, unchanged). Phase 2 (Authentication & Users) is
underway with an approved 8-step plan requiring explicit sign-off after each step.

- **Step 1** (Prisma/PostgreSQL/Redis/configuration infrastructure): complete, locally verified,
  committed, and pushed.
- **Step 2** (User model, auth module foundation, password hashing, and validation): **fully
  verified locally** — `pnpm install`, `prisma validate`/`generate`, a real Docker environment
  (Postgres/Redis/MongoDB/Qdrant), the first migration applied to a real Postgres database,
  `pnpm build`/`lint`/`typecheck`/`test`, and GitHub Actions all passed. One fix applied:
  `PasswordHasherService`'s `argon2.Options & { type: argon2.ArgonType }` failed because installed
  `argon2` v0.41.x doesn't export `ArgonType`; changed to plain `argon2.Options` (preserved as-is).
- **Step 3** (registration, pending-registration flow, OTP generation, email delivery,
  verification, and resend OTP): implementation complete, all three production-readiness blockers
  found by senior-engineer review (stale lockfile, plaintext-OTP-in-production risk, Redis
  read-modify-write races) fixed and locally verified. Per your message, you've since verified
  Step 3 yourself (Docker infra, Prisma migration, `pnpm build`/`lint`/`typecheck`/`test`,
  committed, pushed, GitHub Actions green).
- **Step 4** (login, JWT access/refresh token issuance, refresh, logout, and `/auth/me`):
  implementation complete, **locally verified in this session** — `pnpm build`/`lint`/`typecheck`/
  `test` all pass (`@omniscience/api`: 21/21 suites, 116/116 tests, including 2 tests against a
  real Redis instance proving refresh-token rotation is genuinely single-use under concurrency;
  full monorepo 15/15 turbo tasks green). GitHub Actions has not run yet for this change — needs to
  execute on your end. See `claude/CURRENT_PHASE.md` for full detail, architectural decisions,
  security notes, and known limitations (notably: no refresh-token-family reuse detection, no
  per-account login lockout, `EMAIL_NOT_VERIFIED` currently unreachable through the public API).
  No forgot-password/reset, user-profile, or session-management endpoints yet (later steps, not
  started — awaiting your approval to proceed). No frontend wiring — `LoginPage.tsx`/
  `RegisterPage.tsx` remain UI-only previews.
- **Step 5** (forgot-password + reset-password, OTP-over-email, per `docs/02_SRS.md`):
  implementation complete — `PasswordResetStore` (Redis, same atomic-Lua-script shape as
  `PendingRegistrationStore`), `AuthService.forgotPassword`/`resetPassword`,
  `POST /auth/forgot-password` + `POST /auth/reset-password`. Your local `pnpm test` runs
  surfaced and are helping resolve one e2e test-isolation bug across three rounds: (1) the shared
  `INestApplication`/shared-IP `ThrottlerGuard` state across this file's many requests caused a
  later, unrelated test to hit a real 429 (22/23 suites, 149/150 tests); (2) an
  `overrideProvider(APP_GUARD)` fix attempt didn't work — same failure reproduced; (3) an
  `overrideGuard(ThrottlerGuard)` fix attempt *also* didn't work — same failure reproduced again.
  Rather than try a fourth guard-override variant, the design was changed at the root: a new
  `createTestApp()` helper compiles a fresh `TestingModule`/`INestApplication` (and so a fresh,
  empty in-memory `ThrottlerStorageService`) on demand; the Step 5 describe block now gets its
  **own fresh app per test** (`beforeEach`/`afterEach`), each seeding its own verified/unverified
  user via a new `registerAndVerifyUser()` helper instead of depending on another test or the
  top-level block's account. `ThrottlerGuard` is never overridden, stubbed, or bypassed anywhere —
  it runs for real on every request; no test needs more than one `/auth/forgot-password` call, so
  none can approach the real 3-per-10-minutes limit on its own fresh, zero-count counter. No
  production throttle limit, guard wiring, or `app.module.ts` was touched in any of the three
  rounds. **Still not verified with a real `pnpm install`/Prisma client from this sandbox** — no
  npm/pnpm network egress here, reconfirmed again this session (`pnpm build` and the specific
  `jest test/auth-registration.e2e-spec.ts --runInBand` invocation both still fail with the same
  HTTP 403 at the corepack step). A manual syntax-level check (global `tsc`, no generated Prisma
  client) surfaced only the same category of pre-existing environment-only errors already present
  identically in the untouched Step 3/4 files — no error unique to this fix. **You must re-run
  `pnpm build`/`pnpm lint`/`pnpm typecheck`/`pnpm test` locally and confirm 23/23 suites, 150/150
  tests pass** before this step is considered verified. See `claude/CURRENT_PHASE.md` for full
  detail, architecture, security notes, and known limitations (notably: no session/refresh-token
  revocation on password reset, since `RefreshTokenStore` has no per-user index to revoke from).
  No frontend wiring — `ForgotPasswordPage.tsx`/`ResetPasswordPage.tsx` remain UI-only previews.
  Awaiting your local verification and approval before Step 6.
- **Step 6** (user-profile endpoints — `PATCH /users/me`, `POST /users/me/change-password`): scope
  inferred from Step 4/Step 5's own "known limitations" sections (both explicitly flag
  "user-profile ... endpoints" as the next unbuilt piece after forgot-password) since there is no
  single written enumeration of Steps 6–8 anywhere in the repo — flagged plainly as an inference,
  not a literal spec like Step 5 had. New `UsersModule` (imports `AuthModule` for `JwtAuthGuard`/
  `PasswordHasherService`), both routes behind `JwtAuthGuard` and scoped exclusively to the
  caller's own account via the verified JWT payload. `changePassword` asserts the current password
  first (distinct from Step 5's unauthenticated, OTP-gated `resetPassword`). No email-address
  change, session/device management, or account deletion in this step — left for later steps. No
  new dependencies. **Not yet verified with a real `pnpm install`/Prisma client from this
  sandbox** — no npm/pnpm network egress here (confirmed again this session, `pnpm build` fails
  with the same HTTP 403 at the corepack step). A manual syntax-level check (global `tsc`, no
  generated Prisma client) found no error in any new Step 6 file — every error it reported was in
  untouched, already-verified Step 1–5 files, identical in kind to every prior session. **You must
  run `pnpm install`/`pnpm --filter @omniscience/api exec prisma generate`/`pnpm build`/`pnpm
  lint`/`pnpm typecheck`/`pnpm test` locally before this step is considered verified.** See
  `claude/CURRENT_PHASE.md` for full detail, architecture, security notes, and known limitations
  (notably: no session/refresh-token revocation on password change, for the same reason already
  logged for Step 5). No frontend wiring for these routes. Your local run found a real bug — not in
  the production code, but in `test/users-profile.e2e-spec.ts`'s own Redis fake, which wrongly
  assumed Step 6's routes were the only thing that would ever call Redis, when its own setup
  helper's `/auth/register` call genuinely does. Fixed by extracting the already-correct,
  already-verified fakes out of `test/auth-registration.e2e-spec.ts` into shared
  `apps/api/test/helpers/` modules and pointing both e2e specs at them — a pure extraction, no
  logic changed, no production code touched. Locally verified by you (build/lint/typecheck/test all
  green, 24/24 suites), committed, and pushed.
- **Step 7** (session management — `GET /auth/sessions`, `DELETE /auth/sessions/:tokenId`,
  `POST /auth/sessions/revoke-all`): scope inferred the same way Step 6's was — Step 6's own
  "known limitations" section explicitly flags "session/device listing... left for a later step,
  consistent with the 'session-management endpoints' half of the known-limitations sentence" —
  flagged plainly as an inference, not a literal spec line. `RefreshTokenStore` (Step 4) extended
  with a per-user Redis Set index (best-effort bookkeeping only — the existing per-token key
  remains the sole authority on validity) plus `listSessions`/`revokeSession`/`revokeAllForUser`;
  three new `AuthController` routes reusing the exact `JwtAuthGuard`/`@CurrentUser()` pattern
  Step 6 established. `revokeSession` is membership-checked against the caller's own index before
  touching anything else, so a different user's `tokenId` and an unknown one both produce the same
  `404 SESSION_NOT_FOUND` — no cross-user enumeration. No device/IP metadata, no "current session"
  flag (an access token carries no reference to the refresh-token session that issued it), and no
  automatic session revocation wired into Step 5/6's password-change flows yet — all left for a
  later step. No new npm dependencies. **This session's sandbox, unlike every prior step's, had
  working npm/pnpm network egress** — `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`,
  `pnpm typecheck`, and `pnpm test` were all genuinely executed (not just syntax-checked) and all
  passed: `@omniscience/api` 28/28 suites, 193/193 tests; full monorepo 15/15 turbo tasks green.
  `pnpm --filter @omniscience/api exec prisma generate` could not complete in this sandbox
  specifically — `binaries.prisma.sh` (the query-engine binary host) returned 403, outside this
  environment's network allowlist — but the generated client's TypeScript surface was already
  written by the earlier, successful part of the same command, so typecheck/build/test all still
  ran against a valid `@prisma/client` shape. `docker compose up -d` was not run (no `docker`
  binary in this sandbox); not required, since every test uses the existing
  FakePrismaService/FakeRedisService/FakeMailService trio. The three `*.store.concurrency.spec.ts`
  files (including this step's new real-Redis `revokeSession` race test) self-skipped with their
  existing "no Redis reachable" warning, same documented behavior as every prior session without a
  local Redis. See `claude/CURRENT_PHASE.md` for full detail, architecture, security notes, and
  known limitations. **You must still run `pnpm --filter @omniscience/api exec prisma generate` and
  `docker compose up -d` where they're reachable, and re-run `pnpm test` with a real Redis, to
  confirm the three concurrency specs (including the new one) pass for real rather than
  self-skipping** — everything else has already been confirmed green in-sandbox this session.
  Awaiting your local verification and approval before Step 8.

## Repository Rule

After Phase 0, always continue from the latest working repository. Never create an unrelated
replacement project. Do not modify completed-phase architecture without an explicit instruction to
do so.
