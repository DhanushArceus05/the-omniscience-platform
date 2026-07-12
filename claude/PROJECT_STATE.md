# Project State

## Completed

Vision, core SRS, product design, architecture, hybrid storage, AI coverage matrix, roadmap and
Claude rules. Phase 0 — Foundation. Phase 1 — Premium UI Foundation (design system, theme/motion
systems, adaptive background, responsive app shell, landing page, UI-only auth screens, full
reusable component library in `@omniscience/ui`).

## Current

Phase 1 is complete (see prior entry below, unchanged). The Phase 2 implementation prompt
(Authentication & Users) has been received with finalized decisions (Prisma, Argon2, Redis-backed
OTP/refresh tokens, 15m/7d JWTs, `@nestjs/throttler`, SMTP-with-console-fallback) and an approved
8-step plan requiring explicit sign-off after each step.

**Phase 2 — Step 1 (Prisma, PostgreSQL, Redis, configuration, and infrastructure setup) is
complete** and awaiting verification/approval before Step 2 begins. Local verification caught a
real conflict: the original draft required `db:generate` to succeed while also mandating zero
Prisma models until Step 2 — but `prisma generate` cannot produce a client with no models. Fixed
by deferring `PrismaService`/`PrismaModule` to Step 2 (no dummy/placeholder model added); Step 1
now ships only the static Prisma configuration (`apps/api/prisma/schema.prisma`) plus
`RedisService`/`MailService`/`ConfigModule`, all of which build independently of Prisma
generation. See `claude/CURRENT_PHASE.md` for full detail. As with Phase 1, no network egress
means dependencies were added to `package.json` but not installed, and no build/lint/typecheck/
test command has been executed in this environment — this must be done locally before proceeding
to Step 2.

## Repository Rule

After Phase 0, always continue from the latest working repository. Never create an unrelated
replacement project. Do not modify completed-phase architecture without an explicit instruction to
do so.
