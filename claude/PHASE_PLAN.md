# Phase 6 — Temporary Active Execution Plan

> **What this file is:** the currently-active phase's approved, step-by-step
> execution plan, kept for continuity across new Claude conversations, Claude
> account changes, future ZIP/source snapshots, and general context loss.
>
> **What this file is not:** a replacement for the permanent project record.
> `claude/CURRENT_PHASE.md` and `claude/PROJECT_STATE.md` remain the
> authoritative history of what has actually been built, verified, and
> shipped. This file only tracks the *current* phase's plan and step status;
> it is cleared/archived once the phase is formally closed (Step 6 below).
>
> **Note on provenance:** Steps 4–6 below are a *reconstructed* plan, approved
> in the current conversation — not a recovered original plan. No original
> multi-step Phase 6 plan exists anywhere in this repository (no git history
> ships with the source ZIP, and no doc file records one); see
> `claude/CURRENT_PHASE.md`'s Phase 6 section for the full account of what
> was actually verified.

## Step status

- Step 1 — Conversation & Message Persistence Foundation — COMPLETE
- Step 2 — Backend Streaming — COMPLETE
- Step 3 — Chat Frontend — COMPLETE
- Phase B — Responsive/Polish — COMPLETE
- Post-Phase-B Bugfix Pass — COMPLETE
- Step 4 — Conversation Management — COMPLETE
- Step 5 — Message-Level UX — PENDING
- Step 6 — Phase 6 Close-Out — PENDING

## Step 4 — Conversation Management

STATUS: COMPLETE. Implemented, tested, and verified (build/lint/typecheck/
full test suite all green) this session.

Approved scope:

- Conversation rename
- Conversation delete
- Backend repository/service/controller changes
- Request/response schemas and types
- SDK methods
- Frontend sidebar rename/delete UX
- Optimistic state update + rollback
- Correct handling when the currently-open conversation is deleted
- Backend, SDK, schema, and frontend tests
- Preserve existing ownership/authorization patterns
- No database migration
- No Step 5 or Step 6 implementation during Step 4

**Files changed:** `packages/schemas/src/conversations.ts` (+test),
`packages/schemas/src/index.ts`, `packages/types/src/conversations.ts`,
`packages/types/src/index.ts`, `apps/api/src/conversations/conversations.errors.ts`,
`conversations.repository.ts` (+spec), `conversations.service.ts` (+spec),
`conversations.controller.ts` (+spec), `apps/api/test/conversations.e2e-spec.ts`,
`apps/api/test/helpers/fake-mongo.service.ts` (extended with
`findOneAndUpdate`/`deleteOne`/`deleteMany` — the existing fake only had
`insertOne`/`findOne`/`find`/`updateOne`/`createIndex`, and every e2e test
in the suite runs through it), `packages/sdk/src/client.ts` (+test),
`apps/web/src/features/chat/useConversations.ts` (+test),
`apps/web/src/features/chat/ConversationSidebar.tsx` (+ new test file),
`apps/web/src/features/chat/ChatPanel.tsx` (+test), `apps/web/src/features/chat/chat.css`.

**Two real bugs found and fixed during verification (not present in the
final code — both were caught and fixed before Step 4 was marked
complete):**
1. A stale-closure/timing race in `useConversations.ts`'s rename/delete
   rollback: the first draft captured the pre-call title/index by mutating
   a variable *inside* a `setState` functional updater and reading it back
   immediately after — but React doesn't guarantee that updater runs before
   the next line executes, so the rollback could silently no-op. Fixed by
   reading the pre-call value synchronously from the hook's own `state`
   (added to the `useCallback` dependency array) instead.
2. The new per-row "⋮" options menu's `aria-label` initially embedded the
   full formatted conversation label (`"Options for Conversation — <date>"`
   for untitled conversations), which collided with several pre-existing
   `ChatPanel.test.tsx` tests that query `getByRole("button", { name: /Conversation —/ })`
   for the *select* button — the query became ambiguous. Fixed by using
   the conversation's real title only when one is set, and a generic
   "Options for this conversation" otherwise, which never reproduces that
   substring.

**Verification results:** `pnpm build`, `pnpm lint`, `pnpm typecheck` all
green across all 9 packages. `pnpm test`: API 75 suites/759 tests passed
(the real-Mongo half of `conversations.repository.spec.ts` skips in this
sandbox — no local MongoDB/Docker available here, same pre-existing,
environment-only limitation noted in earlier phases, not a Step 4
regression); web 26 suites/169 tests passed; SDK 59 tests passed; schemas
123 tests passed.

**Known limitations carried forward (not blockers, not new):** same as
before this step — no MongoDB available in this sandbox to run the
repository spec's real-Mongo assertions locally (would run in CI or a
maintainer's machine with `docker compose up -d mongo`); the two
Phase-B/bugfix-pass human-only verification items (browser QA, session
soak test) remain open, tracked for Step 6.

## Step 5 — Message-Level UX

Approved scope:

- Message-level copy
- Regenerate last assistant response
- Edit-and-resend last user message
- Use Option B: one guarded **last-message-only delete** primitive
- Server independently verifies the target is actually the current last
  message before deleting it — no arbitrary message deletion
- Reuse the existing send/send-stream implementation after deletion
- No message versioning
- No branching/tree semantics
- No arbitrary earlier-message editing/regeneration
- No unnecessary changes to the existing streaming architecture
- Accepted limitation (confirmed, not to be architected around): the
  standalone (non-replica-set) MongoDB deployment cannot provide multi-
  document transactions, and a transaction couldn't span the non-
  transactional vendor resend call anyway, so a delete-then-resend flow
  where delete succeeds and resend fails is accepted and must be
  documented as a known limitation, not solved with new infrastructure

## Step 6 — Phase Close-Out

Approved scope:

- Reconcile `claude/CURRENT_PHASE.md`
- Reconcile `claude/PROJECT_STATE.md`
- Document `MarkdownMessage.tsx` under Step 3 (confirmed gap: real, tested,
  dependency-backed component wired into `MessageBubble.tsx`, never listed
  in Step 3's original file list)
- Record Steps 4 and 5 accurately
- Record the two human-only deferred verification items, clearly separated
  from unfinished engineering work:
  - Live browser QA across 9 viewport widths
  - Real-session token-refresh soak test
- Formally close Phase 6 only after Steps 4 and 5 are implemented and
  verified
- Clear/archive this file once Phase 6 is formally closed

## Maintenance rule

Whenever a new phase is formally approved: create/update this file with the
exact number of approved steps and what each is supposed to implement, mark
the current step `IN PROGRESS`, keep future steps `PENDING`, mark a step
`COMPLETE` only once implemented and verified, never silently skip/reorder/
invent/expand steps, update this file before implementation begins on the
next step, and archive it when the phase is formally closed so the next
phase starts a fresh one.
