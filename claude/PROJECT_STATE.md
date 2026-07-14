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

## Repository Rule

After Phase 0, always continue from the latest working repository. Never create an unrelated
replacement project. Do not modify completed-phase architecture without an explicit instruction to
do so.
