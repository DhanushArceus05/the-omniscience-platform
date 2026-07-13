# Project State

## Completed

Vision, core SRS, product design, architecture, hybrid storage, AI coverage matrix, roadmap and
Claude rules. Phase 0 — Foundation. Phase 1 — Premium UI Foundation (design system, theme/motion
systems, adaptive background, responsive app shell, landing page, UI-only auth screens, full
reusable component library in `@omniscience/ui`).

## Current

Phase 1 is complete (see prior entry below, unchanged). Phase 2 (Authentication & Users) is
underway with an approved 8-step plan requiring explicit sign-off after each step.

- **Step 1** (Prisma/PostgreSQL/Redis/configuration infrastructure): complete and verified
  locally (install/build/lint/typecheck/test all passed after two local-verification fix rounds —
  a Prisma-generate-vs-zero-models conflict resolved by deferring `PrismaService` to Step 2, and
  a nodemailer mock typing error in a test file). Committed and pushed.
- **Step 2** (User model, auth module foundation, password hashing, and validation): **complete**,
  awaiting local verification and approval before Step 3. Adds the `User` Prisma model + first
  migration, restores `PrismaService`/`PrismaModule` (deferred from Step 1), an `AuthModule`
  foundation with an Argon2id `PasswordHasherService`, shared Zod validation schemas
  (`packages/schemas/src/auth.ts`), and a generic `ZodValidationPipe` — none wired to any
  endpoint yet. See `claude/CURRENT_PHASE.md` for full detail, including that the first migration
  was hand-authored (no live Postgres/CLI available here) and should be verified against a real
  `prisma migrate dev` run locally. As before, no network egress means no install/build/lint/
  typecheck/test command has been executed in this environment — must be done locally before
  proceeding to Step 3.

## Repository Rule

After Phase 0, always continue from the latest working repository. Never create an unrelated
replacement project. Do not modify completed-phase architecture without an explicit instruction to
do so.
