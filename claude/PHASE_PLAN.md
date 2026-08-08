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
- Step 4 — Conversation Management — COMPLETE (implementation, local
  verification, commit, and push all done; user has explicitly confirmed
  the push)
- Step 5 — Message-Level UX — COMPLETE (implementation, full
  verification, bugfix round, local QA, and user confirmation all
  done — see the Step 5 section below)
- Step 6 — Phase 6 Close-Out — ACTIVE / CURRENT STEP (not yet started —
  see the Step 6 section below for approved scope; awaiting the next
  go-ahead before implementation begins)

## Step 4 — Conversation Management

STATUS: COMPLETE. Implementation, local verification (build/lint/typecheck/
full test suite all green, including the real-Mongo repository spec —
19/19 — for real on the user's machine), manual browser QA, commit, and
push are all done, and the user has explicitly confirmed the push. This
step is now officially complete per this project's locked workflow: local
verification → explicit approval → git commit → git push → user
confirmation of the push — all five have happened.

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

**Two real bugs found and fixed during in-sandbox verification (not present in the
final code — both were caught and fixed before local verification concluded):**
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

**Verification results — in-sandbox (this session, environment-limited):**
`pnpm build`, `pnpm lint`, `pnpm typecheck` all green across all 9
packages. `pnpm test`: API 75 suites/759 tests passed (the real-Mongo half
of `conversations.repository.spec.ts` skipped in-sandbox — no local
MongoDB/Docker available here); web 26 suites/169 tests passed; SDK 59
tests passed; schemas 123 tests passed.

**Verification results — user's local machine (authoritative, supersedes
the in-sandbox numbers above for anything the sandbox couldn't run):** API
75 suites/759 tests passed, **including the real-Mongo repository spec,
19/19 tests passing for real** (the one suite the sandbox could never
exercise); web 169 tests passed; SDK 59 tests passed; schemas 123 tests
passed; full build, lint, and typecheck all successful. The user also
manually verified the actual behavior in a browser: rename works and
persists after refresh; delete works and stays deleted after refresh;
deleting the currently-open conversation correctly clears back to a
fresh/no-active-conversation state. Local verification is complete.

An intermediate local run had surfaced 19/19 failures in
`conversations.repository.spec.ts` (all-or-nothing, matching a
`beforeAll`/environment-level failure rather than a Step 4 logic bug —
confirmed by the fact that all 13 pre-existing Step 1/2 tests in that file
failed identically alongside the 6 new Step 4 tests, and by
`FakeMongoService`'s additions — the only Step-4-touched code that suite
doesn't even use — already being proven correct via the separately-passing
e2e suite). That was resolved as a local MongoDB/environment setup issue
on the user's machine, not a code defect; no application code was changed
as a result.

**Known limitations:** the in-sandbox environment used for implementation
still has no MongoDB/Docker available, so the real-Mongo repository spec
can only be run here in skip mode — this is a sandbox-only limitation,
now fully resolved on the user's own machine (19/19 real-Mongo tests
passing, see above). The two Phase-B/bugfix-pass human-only verification
items (browser QA, session soak test) remain open, tracked for Step 6.

## Step 5 — Message-Level UX

STATUS: COMPLETE.

Implementation, full in-sandbox verification, the critical bugfix round
(full-history pagination + URL-based conversation-selection persistence),
and the user's own local QA all passed. The user confirmed: full
conversation history persists correctly; reload no longer loses
newly-created messages; refresh restores the currently-open conversation;
navigation between conversations no longer loses state; the latest user
message can be edited; the latest assistant message can be regenerated;
older messages intentionally cannot be edited/regenerated (matches the
approved last-turn-only scope); copy still works correctly. No
implementation issues remain. Step 6 is now the active/current step —
see below.

**Already implemented and confirmed via re-investigation — MUST NOT be
reimplemented:** message-level copy (`MessageBubble.tsx`'s whole-message
"Copy message" button + `MessageBubble.test.tsx` coverage). This predates
Step 4 — it's an undocumented pre-existing Step-3-era feature, not new
work. Flagged for Step 6 documentation reconciliation alongside the
`MarkdownMessage.tsx` gap. Excluded from this step's implementation.

**Genuinely new work this step:**

1. **Guarded last-message-only delete primitive** — `DELETE
   :conversationId/messages/:messageId`. Re-derives the true last message
   server-side on every call (never trusts the client's claim); only
   succeeds when the target genuinely is the current last message.
   `MESSAGE_NOT_FOUND` (404, no-enumeration, same convention as
   `CONVERSATION_NOT_FOUND`) vs. `MESSAGE_NOT_LAST` (409 — exists, is the
   caller's, but isn't the last message right now). Files:
   `conversations.errors.ts`, `.repository.ts` (`getLastMessage`,
   `deleteMessage`, same `createdAt`+`_id` ordering `listMessages` already
   uses), `.service.ts` (ownership via `getOwnedConversationOrThrow()`
   first, then the two-way error mapping), `.controller.ts` (new `DELETE`
   route, same guard/throttle/param-validation conventions as every other
   conversation write), `packages/schemas` (`messageIdParamSchema`, same
   ObjectId regex as `conversationIdParamSchema`), `packages/types`
   (`DeleteMessageResponse { deleted: true }`), `packages/sdk`
   (`deleteMessage()`, same conventions as `deleteConversation()`).
2. **Regenerate last assistant response** — eligible only when a message
   is `role: "assistant"`, is the true final entry in the frontend's
   message array, and is neither streaming nor optimistic. Flow: delete
   via the new primitive → only on success, remove it from local state →
   resend the immediately-preceding user message's actual content (read
   live from current message state, not from `lastSentContentRef`, which
   can be stale after a prior retry) through the existing, **unmodified**
   `sendMessage`/`sendMessageStream` path. No new backend endpoint for
   this — pure frontend orchestration on top of the delete primitive.
3. **Edit-and-resend last user message** — eligible only for the true
   last user-role message (whether or not a trailing assistant reply
   exists), never optimistic. If a trailing assistant reply exists,
   delete it first, then delete the now-last user message, then resend
   the edited content; if there's no trailing reply, just delete-then-
   resend the user message. No `PATCH` message mutation, no versioning,
   no supersede chains, no branching. Earlier-message editing/
   regeneration stays explicitly out of scope.
4. **Frontend state**: `useMessageStream.ts` gains a `remove_trailing`
   reducer action (removes successfully-deleted trailing messages by id
   — the existing reducer only ever appended/mutated before this) and
   `regenerateLastAssistantMessage()`/`editLastUserMessage(newContent)`,
   both reusing the existing send/stream lifecycle unchanged. A failed
   delete never removes the local message and never triggers a resend —
   surfaced through the existing `streamError` mechanism.
   `MessageList.tsx` computes eligibility from its own `messages` array
   and passes booleans/callbacks to the one eligible `MessageBubble`.
   `MessageBubble.tsx` gains a Regenerate action (assistant, next to
   Copy) and an Edit action (user) that switches the bubble into inline
   editing — Save/Cancel, Enter commits, Escape cancels, empty edits
   rejected — mirroring `ConversationSidebar`'s existing inline-rename
   pattern rather than inventing a new one. `ConversationThread.tsx` is
   not expected to need changes.

**Accepted limitation (confirmed, not to be architected around):** the
standalone (non-replica-set) MongoDB deployment cannot provide multi-
document transactions, and even one couldn't span the non-transactional
external AI-provider resend call anyway — so a delete-then-resend flow
where delete succeeds and resend fails is accepted (the deleted message(s)
stay deleted; the user retypes/resends) and must be documented, not solved
with new infrastructure (no replica-set migration, no distributed
transactions, no version trees, no branching, no recovery infrastructure).

**Implementation note (not a limitation — the approved design working as
specified):** regenerate resends through the ordinary `sendMessage()`
path, which always creates a genuinely new user message via the normal
send flow. So after a regenerate, the conversation has three messages
where it had two — the original user message, a new resent copy of it,
and the new assistant reply — not two. Only the *old* assistant reply is
actually removed. Edit-and-resend does not have this effect, because it
also deletes the old user message before resending, leaving exactly two
messages (the edited user message, the new assistant reply).

**Strictly out of scope, confirmed untouched:** `ModelSelectorService`,
`GeminiProvider`, `gemini-error-mapper.ts`, provider priorities/
registration order/fallback behavior, and any OmniCore provider-selection
architecture — the separately-investigated Gemini upstream-availability
issue does not enter this step.

**Files changed:** `apps/api/src/conversations/conversations.errors.ts`,
`.repository.ts` (+spec), `.service.ts` (+spec), `.controller.ts` (+spec),
`apps/api/test/conversations.e2e-spec.ts`, `packages/schemas/src/conversations.ts`
(+test), `packages/schemas/src/index.ts`, `packages/types/src/conversations.ts`,
`packages/types/src/index.ts`, `packages/sdk/src/client.ts` (+test),
`apps/web/src/features/chat/useMessageStream.ts` (+test),
`apps/web/src/features/chat/MessageList.tsx` (+test),
`apps/web/src/features/chat/MessageBubble.tsx` (+test),
`apps/web/src/features/chat/ConversationThread.tsx` (callback wiring only).
Message-level copy (`MessageBubble.tsx`'s existing "Copy message" button)
was **not** touched — confirmed pre-existing, see above.

**Two real bugs found and fixed during this step's own verification, before
being marked "implementation verified" (both are already fixed in the
code — recorded here for the historical record):**
1. An accessible-name collision in `MessageBubble.tsx`: the inline edit
   `Input` and the "Edit" trigger button both initially used the aria-label
   `"Edit message"`, so a query for the input by that label could instead
   match the button once editing closed. Fixed by giving the input its own
   distinct label, `"Edit message content"`.
2. A wrong test expectation (not a code bug) in `useMessageStream.test.ts`:
   the first draft of the regenerate test asserted the conversation would
   have 2 messages afterward, but per the approved design (see the
   "Implementation note" above) the correct, intended result is 3. Fixed
   by correcting the test's assertion, not the implementation.

Also caught and fixed one incorrect e2e test assumption during backend
verification: a test asserted that deleting another owner's message
returns `MESSAGE_NOT_FOUND`, but the actual (correct, secure) behavior is
`CONVERSATION_NOT_FOUND` — the top-level ownership check on the
conversation itself rejects first, before anything message-specific is
ever reached, exactly mirroring how `rename`/`remove` already behave for a
conversation the caller doesn't own. Fixed the test's expectation, not the
implementation.

**Verification (in-sandbox, this session):** `pnpm build`, `pnpm lint`,
`pnpm typecheck` all green across all 9 packages. `pnpm test`: schemas 129
tests passed; SDK 62 tests passed; web 26 suites / 197 tests passed; API —
`conversations.repository.spec.ts` 28 tests passed (real-Mongo half still
skips in-sandbox, same pre-existing environment-only limitation as Steps
1–4), `conversations.service.spec.ts` + `conversations.controller.spec.ts`
48 tests passed, `conversations.e2e-spec.ts` 40 tests passed, every other
API unit suite (ai/auth/omnicore/users/workspaces/avatar/common/config/
health/mail/mongo/prisma/redis) 580 tests passed, every other API e2e
suite (account-deletion/ai-generate/health/auth-registration/avatar/
session-management/users-profile/workspaces) 83 tests passed. Nothing
skipped except the same real-Mongo/real-Redis environment gaps already
true for every prior step.

---

### Critical bugfix round — user's real browser QA found 2 real implementation bugs

The user's own manual QA of the round above (before any commit) found two genuine, reproducible
implementation bugs — **not** environment issues, and **not** false positives — that this in-sandbox
verification pass had not caught, since neither manifests until a conversation crosses the 20-message
page-size boundary. Both were fixed and re-verified (see below); at that point status was
**IMPLEMENTATION VERIFIED — AWAITING LOCAL USER QA / COMMIT**, not COMPLETE, pending the user's next
QA pass — since superseded by that QA pass passing; see this section's STATUS line above for the
current, final status.

**Root cause (shared by both reported issues):** `ConversationThread.loadHistory()` called
`client.listMessages(...)` exactly once, with no `cursor`, and never followed `nextCursor`. The
backend's `listMessages` is bounded and cursor-paginated, oldest-first
(`DEFAULT_MESSAGE_LIST_LIMIT = 20`) — so for any conversation with more than 20 messages, the
frontend only ever loaded and displayed the *oldest* 20, silently dropping everything newer. This is
a **pre-existing Step 3 gap**, not something Step 5 introduced — Step 5's own QA (repeatedly testing
regenerate/edit) was simply the first time a test conversation's message count crossed that
threshold, exposing it.

- **Reported Issue 1 (critical) — new messages "disappear" after refresh/navigate-away-and-back:**
  every reload re-fetched the same stale oldest-20 page; anything sent after that point was
  persisted correctly server-side the whole time, just never asked for.
- **Reported Issue 2 — Edit/Regenerate don't work on pre-existing (long) conversations:**
  `MessageList`'s eligibility (is this bubble the true last message?) is computed from the loaded,
  truncated list — on a long conversation its last *loaded* message wasn't the server's actual last
  message, so the guarded delete correctly (but confusingly) rejected with `409 MESSAGE_NOT_LAST`.
  On a short, freshly-created conversation the loaded list's last message *is* the true last one, so
  it worked — exactly matching the reported "new conversations work, old ones don't" split.

**Fix 1 — full-history pagination.** `ConversationThread.tsx`'s `loadHistory()` now loops, following
each page's `nextCursor` (requesting `MAX_MESSAGE_LIST_LIMIT` (50) per page) until exhausted, capped
by a defensive `MAX_HISTORY_PAGES = 10` circuit breaker (500 messages) against an unforeseen
server-side cursor bug turning into an infinite loop rather than a visible error. Ordering stays
chronological (each page is already ascending; pages are appended in cursor order), and there are no
duplicates (the cursor's `$gt` filter strictly excludes already-seen ids) — the existing
loading/error UI states were not touched.

**Fix 2 — URL-based conversation-selection persistence.** The reported "after a browser refresh it
navigates back to the conversation list" behavior was a separate, additional pre-existing gap
(`ChatPanel`'s `activeConversationId` lived only in React state, never reflected in the URL) that the
user explicitly asked to have investigated alongside Issue 1. Added an optional `:conversationId`
route segment (`/app/workspace/:workspaceId/chat/:conversationId`, alongside the existing
conversation-less route) in `App.tsx`; `ChatPage.tsx` reads it and passes it to `ChatPanel` as
`initialConversationId` (seeds the initial selection only); `ChatPanel.tsx` now keeps the URL in sync
with the live selection via `navigate(..., { replace: true })` on every select/create/clear, so
switching conversations doesn't spam browser history, and a hard refresh restores exactly the
conversation that was open.

**Files changed this round:** `apps/web/src/features/chat/ConversationThread.tsx` (+test),
`apps/web/src/App.tsx` (new route), `apps/web/src/pages/ChatPage.tsx`, `apps/web/src/features/chat/ChatPanel.tsx`
(+test). Also fixed two now-stale test assertions that predated this fix and would otherwise have
failed once `listMessages()` started passing a query argument on every call:
`ChatPanel.test.tsx`'s two strict `listMessages` call-argument assertions were loosened to
`expect.anything()` for the new 4th (query) parameter.

**Re-verification after this round:** `pnpm build`, `pnpm lint`, `pnpm typecheck` all green again
across all 9 packages. `pnpm test`: web 26 suites / 201 tests passed (4 net-new: 2 pagination tests
in `ConversationThread.test.tsx`, 2 URL-sync tests in `ChatPanel.test.tsx`); the conversations backend
suites (`conversations.repository.spec.ts` 28, `conversations.service.spec.ts` +
`conversations.controller.spec.ts` 76 combined, `conversations.e2e-spec.ts` 40) and schemas (129) /
SDK (62) were re-run and remain green — none of this round's changes touched backend/SDK/schemas
code, so no regression was expected or found there.

---

**Final local QA — completed, Step 5 officially COMPLETE.** The user's own local replace-and-run and
a fresh round of manual browser QA covering both the original Step 5 features and specifically the
two bugs fixed above all passed: full conversation history persists correctly; reload no longer
loses newly-created messages; refresh restores the currently-open conversation; navigation between
conversations no longer loses state; the latest user message can be edited; the latest assistant
message can be regenerated; older messages intentionally cannot be edited/regenerated (matches the
approved last-turn-only scope); copy still works correctly. No implementation issues remain. The
user has explicitly confirmed this and asked for Step 5 to be marked COMPLETE and Step 6 to become
the active step.

## Step 6 — Phase Close-Out

STATUS: ACTIVE / CURRENT STEP — not yet started. Awaiting explicit
go-ahead before implementation begins (this step is documentation/
reconciliation only — no new features).

Approved scope:

- Reconcile `claude/CURRENT_PHASE.md`
- Reconcile `claude/PROJECT_STATE.md`
- Document `MarkdownMessage.tsx` under Step 3 (confirmed gap: real, tested,
  dependency-backed component wired into `MessageBubble.tsx`, never listed
  in Step 3's original file list)
- Document the whole-message "Copy message" action under Step 3 (confirmed
  gap during Step 5 re-investigation: real, tested, in `MessageBubble.tsx`
  since before Step 4, never listed in Step 3's original file list either)
- Record Steps 4 and 5 accurately, including Step 5's critical bugfix round
  (full-history pagination in `ConversationThread.tsx`, URL-based
  conversation-selection persistence) — both fixed a pre-existing Step 3
  gap the original Step 3 write-up should be corrected to reflect, not
  just Step 5's own record of it
- Record the two human-only deferred verification items, clearly separated
  from unfinished engineering work:
  - Live browser QA across 9 viewport widths
  - Real-session token-refresh soak test
- Formally close Phase 6 only after Steps 4 and 5 are implemented and
  verified — both are now done
- Clear/archive this file once Phase 6 is formally closed

## Maintenance rule

Whenever a new phase is formally approved: create/update this file with the
exact number of approved steps and what each is supposed to implement, mark
the current step `IN PROGRESS`, keep future steps `PENDING`, mark a step
`COMPLETE` only once implemented and verified, never silently skip/reorder/
invent/expand steps, update this file before implementation begins on the
next step, and archive it when the phase is formally closed so the next
phase starts a fresh one.
