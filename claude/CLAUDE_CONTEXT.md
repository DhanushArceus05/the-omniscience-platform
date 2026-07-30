# Claude Context

Project: The Omniscience Platform
Tagline: One Platform. Every Intelligence.
Main Product: The Omniscience Assistant
Current Phase: Phase 6 — Omniscience Assistant, Step 1 implemented this session (runtime
verification pending — see claude/CURRENT_PHASE.md); Phase 5 overall still not formally declared
complete as a whole (no Phase 5 Step 6 defined; harmless, since Phase 6 work already builds on
Phase 5 Steps 1–5 as instructed)

## Progress summary (continuity only — not authoritative)

- Phase 0 — Foundation: complete.
- Phase 1 — Premium UI Foundation: complete.
- Phase 2 — Authentication & Users: complete (all 8 backend steps + frontend auth integration).
- Phase 3 — Dashboard & Workspace: complete (all 4 steps).
- Phase 4 — OmniProvider & Model Manager: complete (all 5 steps).
- Phase 5 — OmniCore: Steps 1–5 complete (Foundation, Intent Intelligence, Task Planning Engine,
  Execution Orchestration Engine, Tool Calling Framework). Phase 5 has not been declared complete
  as a whole, and no Phase 5 Step 6 has been defined.
- Phase 6 — Omniscience Assistant, Step 1 (Conversation & Message Persistence Foundation):
  implemented this session — `MongoModule`/`MongoService` and `ConversationsModule`
  (create/list/get conversations, list/send messages, routed through the existing
  `OmniCoreService.execute()`). **Not yet runtime-verified** — this session's sandbox had no
  network egress at all, so `pnpm install`/`build`/`lint`/`typecheck`/`test` could not be run. See
  `claude/CURRENT_PHASE.md`'s "Phase 6 — Omniscience Assistant, Step 1" section for full detail
  and the exact commands a maintainer with network access must still run. No further Phase 6 step
  has been started.

**Do not reimplement, rewrite, revert, or duplicate any completed phase or step.** Do not begin
work on the next undecided step (Phase 6 Step 2 onward) without an explicit instruction to do so.

## Authoritative source of truth

`claude/PROJECT_STATE.md` and `claude/CURRENT_PHASE.md` are the current, detailed, step-by-step
progress records for this repository and take precedence over this file and over any prior chat
history. Read them, along with every file in `/docs`, before making changes.

Core constraints: monorepo, modular monolith, React/Vite, NestJS, FastAPI, hybrid storage, premium
frontend, all major AI domains, free-first, current phase only.
