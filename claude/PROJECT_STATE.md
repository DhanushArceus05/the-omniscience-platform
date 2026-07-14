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
  verification, and resend OTP): implementation complete. A senior-engineer review found three
  production blockers (stale lockfile, plaintext-OTP-in-production risk, Redis read-modify-write
  races); **all three are now fixed and locally verified** — `pnpm install --frozen-lockfile`,
  `pnpm build`/`lint`/`typecheck`/`test` all pass (including new tests against a real Redis
  instance proving the atomic-Redis fix under genuine concurrency). GitHub Actions has not run
  yet for this change — the workflow was updated to add a `redis` service container and needs to
  execute on your end. See `claude/CURRENT_PHASE.md` for full detail, architectural decisions, and
  known limitations. No login/JWT issuance yet (Step 4, not started — awaiting your approval to
  proceed).

## Repository Rule

After Phase 0, always continue from the latest working repository. Never create an unrelated
replacement project. Do not modify completed-phase architecture without an explicit instruction to
do so.
