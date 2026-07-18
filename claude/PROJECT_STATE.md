# Project State

## Completed

Vision, core SRS, product design, architecture, hybrid storage, AI coverage matrix, roadmap and
Claude rules. Phase 0 — Foundation. Phase 1 — Premium UI Foundation (design system, theme/motion
systems, adaptive background, responsive app shell, landing page, UI-only auth screens, full
reusable component library in `@omniscience/ui`).

## Current

Phase 1 is complete (see prior entry below, unchanged). **Phase 2 (Authentication & Users) is
complete** — all 8 backend steps plus the frontend auth integration are implemented, locally
verified, **committed, and pushed** (superseding the "not yet committed, awaiting your local
verification" note this section previously carried — that verification has since happened).
ChatGPT's senior architecture/security/code-quality review of Phase 2 has taken place and Phase 3
has begun.

**Post-Phase-2 UI fixes (verified, committed, pushed):** tooltip overflow and notification tooltip
alignment issues were fixed; a mouse-movement flashing artifact was traced to a static
`backdrop-filter` blur on the app sidebar and glass cards and disabled in
`apps/web/src/layout/appShell.css` and `packages/ui/src/styles/components.css`. Do not undo these
fixes.

**Phase 3 — Dashboard & Workspace, Step 1 (Protected Routing and Session Bootstrap): complete,
locally verified this session** (`pnpm install --frozen-lockfile`, `pnpm build`/`lint`/`typecheck`/
`test`, all real runs — this sandbox had working npm/pnpm network egress). `/app` is now a real
authenticated route: `AuthContext` gained an `authStatus: "loading" | "authenticated" |
"unauthenticated"` bootstrap state machine that verifies any persisted session against
`GET /auth/me`, refreshing once via `POST /auth/refresh` and retrying `/auth/me` if the access
token had expired, and clearing all local state if that can't be salvaged; `ProtectedRoute`
(`apps/web/src/lib/auth/ProtectedRoute.tsx`, new) renders a loading state during bootstrap (never
redirecting prematurely) and redirects to `/login` only once bootstrap confirms the user is
logged out, preserving the originally-requested route so login can return them there.
`@omniscience/sdk`'s `OmniscienceClient` gained `refresh()`/`getMe()`. No dashboard widgets,
workspace data, or new Prisma models — see `claude/CURRENT_PHASE.md`'s "Phase 3 Step 1" section
for full detail, architecture, and known limitations (notably: no proactive/background token
refresh once inside `/app`, only the bootstrap-on-mount check; the "return to originally-requested
route" behavior is wired through `LoginPage` only, not yet through the register→verify→login or
forgot/reset-password flows). Test counts this session: `@omniscience/sdk` 13/13 (+5),
`@omniscience/web` 40/40 across 8 files (+7 net), `@omniscience/api` 205/205 (unchanged, no
backend files touched), `@omniscience/ui` 80/80 (unchanged); full monorepo 15/15 turbo tasks green
across build/lint/typecheck/test. `prisma generate`/`docker compose` remain unavailable in this
sandbox for the same previously-documented reasons (irrelevant here — no backend code changed).
Awaiting your local re-run and confirmation, then ChatGPT's senior review, before Phase 3 Step 2.
Do not begin Phase 3 Step 2 until that approval lands.

**Phase 3 — Dashboard & Workspace, Step 2 (Workspace Data Model, Ownership Isolation & Dashboard
Listing): locked and implemented this session, locally verified** (`pnpm install
--frozen-lockfile`, `pnpm build`/`lint`/`typecheck`/`test`, all real runs against a real local
Redis — this sandbox had working npm/pnpm network egress). A `Workspace` Prisma model was added
(`onDelete: Cascade` on `ownerId`, approved) with `POST /workspaces`, `GET /workspaces` (bounded,
keyset/cursor-paginated, newest-first, default limit 20/max 50), and `GET /workspaces/:id` — all
behind `JwtAuthGuard`, ownership always from the verified JWT, never request input; a missing
workspace and another owner's workspace both return the identical `404 WORKSPACE_NOT_FOUND`. **No
update or delete endpoint** — deliberately not full CRUD. `AppShellPreviewPage`'s "Dashboard
arrives in Phase 3" placeholder was replaced with a real `WorkspaceDashboard`
(`apps/web/src/features/workspaces/`): loading, real empty state, populated list, a create-workspace
modal with client-side validation against the same shared Zod schema the backend uses, and a
recoverable error state with retry — a successful create updates the list immediately with no page
refresh, and there is no "Open workspace" action or detail route (not required by this step). No
broad automatic 401-refresh-and-retry was added to the new SDK methods — that remains a documented
future step, same gap Phase 3 Step 1 already flagged. See `claude/CURRENT_PHASE.md`'s "Phase 3 Step
2" section for full architecture, migration, and test detail. Test counts this session:
`@omniscience/api` 234/234 across 33 suites (+29/+4 from Step 1's 205/29), `@omniscience/schemas`
70/70 (+16), `@omniscience/sdk` 23/23 (+10), `@omniscience/web` 54/54 across 10 files (+8, no
existing Step 1 test file changed or regressed), `@omniscience/ui`/`@omniscience/config`/
`@omniscience/utils` unchanged; full monorepo 15/15 turbo tasks green. `prisma generate`'s
schema-engine binary still could not be downloaded in this sandbox (`binaries.prisma.sh` 403,
outside the network allowlist — the same restriction documented since Phase 2 Step 3); this did
not block `build`/`typecheck`, which compiled cleanly against the real (if binary-incomplete)
generated Prisma client already present from prior installs. The migration SQL is hand-authored,
same caveat as Phase 2 Step 2's users-table migration. Awaiting your local `prisma generate`/
migration apply against a real Postgres and your approval before Phase 3 Step 3. Do not begin
Phase 3 Step 3 until that approval lands.

### Phase 2 step-by-step history (unchanged from when each step was implemented)

- **Frontend auth integration (post-Step-8, pre-commit)**: `RegisterPage`/`VerifyOtpPage`/
  `LoginPage`/`ForgotPasswordPage`/`ResetPasswordPage` now call the real `/auth/*` endpoints Steps
  3–5 built, via a new SDK layer (`OmniscienceClient` in `@omniscience/sdk`, extended with
  `register`/`verifyOtp`/`resendOtp`/`login`/`logout`/`forgotPassword`/`resetPassword` and a new
  `ApiClientError`) and one new `AuthContext`/`useAuth()` (`apps/web/src/lib/auth/`) that persists
  a logged-in session's tokens to `localStorage`. `ResetPasswordPage` gained a previously-missing
  OTP field (the backend contract requires `{ email, otp, newPassword }`). All "Preview only"/
  "arrives in Phase 2" copy is removed. User-profile, change-password, session-management, and
  account-deletion endpoints (Steps 6–8) deliberately still have **no frontend page** — reachable
  only via the API directly until a later step/phase builds their UI. No backend production code
  was modified. **Not verified with a real `pnpm install` from this sandbox** — no npm/pnpm network
  egress here this session (same `HTTP 403` at the corepack step as every prior no-network
  session); reviewed manually against the actual shared contracts/component signatures instead,
  which caught and fixed one real regression in the pre-existing `App.test.tsx` (a `/verify-otp`
  test that navigated with no router state). See `claude/CURRENT_PHASE.md`'s "Post-Step-8" section
  for full detail. **You must run `pnpm install --frozen-lockfile`/`pnpm build`/`pnpm lint`/`pnpm
  typecheck`/`pnpm test` locally and report the result before this is committed.**

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
- **Step 8** (account deletion — `DELETE /users/me`; **final step of Phase 2**): scope inferred
  the same way as Step 6/7's — Step 6's own scope section explicitly listed "Account deletion" as
  excluded/deferred alongside session management (which shipped in Step 7); this is the one
  remaining item from that sentence. Requires the current password (same reasoning
  `changePassword` already established); on success, permanently deletes the `User` row and calls
  Step 7's `RefreshTokenStore.revokeAllForUser` — the first flow to wire that primitive in
  automatically rather than only exposing it directly via `/auth/sessions/revoke-all`. Required
  exporting `RefreshTokenStore` from `AuthModule` (it was already a provider, just not previously
  exported) — the only place this step touches already-completed Step 1–7 code, and purely
  additive (widening an `exports` array cannot change existing behavior). No soft-delete/grace
  period, no cascading deletion (nothing downstream exists yet), no deletion-confirmation email,
  no admin-initiated deletion of another user's account — all deliberately out of scope. No new
  dependencies. **This session's sandbox (same one as Step 7's) still had working npm/pnpm network
  egress** — `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` were all genuinely
  executed and all passed: `@omniscience/api` 29/29 suites, 203/203 tests (up from Step 7's 28/193);
  full monorepo 15/15 turbo tasks green. `pnpm --filter @omniscience/api exec prisma generate` was
  not re-run this session (Step 7's session already established `binaries.prisma.sh` is outside
  this sandbox's network allowlist, and this step's unchanged Prisma schema means re-running would
  only reproduce the identical, already-diagnosed 403); `docker compose up -d` was not run (no
  `docker` binary in this sandbox) — neither blocked build/lint/typecheck/test, which all run
  against the existing Fake*Service trio. See `claude/CURRENT_PHASE.md` for full detail,
  architecture, security notes, and known limitations. **You must still run
  `pnpm --filter @omniscience/api exec prisma generate` and `docker compose up -d` where they're
  reachable, and re-run `pnpm test` with a real Redis, to confirm the three concurrency specs pass
  for real** — everything else has already been confirmed green in-sandbox this session. This is
  the final step of Phase 2 — Phase 3 has not been started. Awaiting your local verification, after
  which ChatGPT will perform the full Phase 2 senior architecture/security/code-quality review
  before Phase 3 begins.

## Repository Rule

After Phase 0, always continue from the latest working repository. Never create an unrelated
replacement project. Do not modify completed-phase architecture without an explicit instruction to
do so.
