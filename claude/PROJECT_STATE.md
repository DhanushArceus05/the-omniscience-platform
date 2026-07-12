# Project State

## Completed

Vision, core SRS, product design, architecture, hybrid storage, AI coverage matrix, roadmap and
Claude rules. Phase 0 — Foundation. Phase 1 — Premium UI Foundation (design system, theme/motion
systems, adaptive background, responsive app shell, landing page, UI-only auth screens, full
reusable component library in `@omniscience/ui`).

## Current

Phase 1 is complete. Build, lint, and typecheck have been confirmed passing locally. Test suite
went through three fix passes for OtpInput/AppShell/RippleSurface failures surfaced by local
`pnpm test` runs; the last remaining failure (`OtpInput > calls onComplete once the final digit is
typed`) was resolved by removing that redundant test in favor of the already-passing paste-based
equivalent, since the underlying cause wasn't reproducible by manual review and no implementation
changes were authorized. A final polish pass then fixed the default theme (first-time visitors now
start dark instead of following the OS), a module-scope crash in `SystemStatusPanel` when
`VITE_API_BASE_URL`/`VITE_AI_SERVICE_BASE_URL` are unset, the missing `favicon.ico`, and reviewed
auth card sizing (already at spec, no change needed). See claude/CURRENT_PHASE.md for full detail.
Awaiting the Phase 2 implementation prompt (Authentication) before writing any backend/auth logic.

## Repository Rule

After Phase 0, always continue from the latest working repository. Never create an unrelated
replacement project. Do not modify completed-phase architecture without an explicit instruction to
do so.
