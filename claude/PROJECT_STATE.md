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

**Phase 3 — Dashboard & Workspace, Step 3 (Profile, Avatar, Security & Account Settings
Experience): locked and implemented this session.** A single settings experience at
`/app/settings` (Profile/Security/Sessions/Danger Zone tabs) replaces the account menu's disabled
"Profile (coming soon)"/"Settings (coming soon)" entries and the sidebar's dead `/app/settings`
link. Avatar upload/replace/remove is backed by a new `AvatarStorageService`
(`apps/api/src/avatar/`) — local disk under `AVATAR_STORAGE_DIR`, served back out by the API as
static files, validated by both declared MIME type and actual magic-byte signature (JPEG/PNG/WebP
only, no SVG, 5MB cap, safe randomly-generated filenames, old-file cleanup on replace/delete/
account-deletion) — this repo had no existing pluggable object-storage abstraction, so this is
deliberately the first one, kept behind a narrow interface for a future real object-storage swap.
One new nullable column, `User.avatarStorageKey` (never a stored URL — the public URL is always
derived at read time). Two new endpoints, `POST`/`DELETE /users/me/avatar`; display-name update,
change-password, session list/revoke/revoke-all, and account deletion all reuse **already-existing**
Phase 2 Steps 6–8 backend endpoints — this step only added SDK methods (`updateProfile`,
`uploadAvatar`, `deleteAvatar`, `changePassword`, `deleteAccount`, `listSessions`, `revokeSession`,
`revokeAllSessions`, none with 401-retry) and the UI to call them. `AuthContext` gained one
additive `updateUser(patch)` method so a successful name/avatar change reflects in the TopBar/
UserMenu immediately with no reload; session bootstrap and logout are unchanged. Account deletion
requires both the current password (backend) and a UI-only typed "DELETE MY ACCOUNT" confirmation,
then clears the local session and redirects to `/login`. See `claude/CURRENT_PHASE.md`'s "Phase 3
Step 3" section for full detail. **Verified this session:** `@omniscience/schemas` 70/70,
`@omniscience/types` 2/2, `@omniscience/config` 20/20, `@omniscience/sdk` 35/35,
`@omniscience/ui` 81/81 (untouched), `@omniscience/web` 82/82 across 15 files, plus clean
build/lint/typecheck for `@omniscience/web` and clean lint for `@omniscience/api`. **Not verified
this session: `@omniscience/api`'s build/typecheck/test.** `prisma generate` cannot complete in
this sandbox (`binaries.prisma.sh` 403, outside the network allowlist) and — unlike Step 2's
session — no previously-generated Prisma client happened to exist here this time, so there was
nothing for `tsc`/`ts-jest` to compile against. No stub or workaround was created or kept to paper
over this; a hand-written type stub created earlier in the session was deleted before finishing,
per instruction. Every `tsc` failure this produces is exactly and only a missing-generated-type
error (`Property 'user'/'workspace' does not exist on type 'PrismaService'`), not a reported logic
error, and ESLint (which needs no generated client) passes cleanly across all of `apps/api`. Run
locally, where `binaries.prisma.sh` is reachable, before trusting this package:
`pnpm --filter @omniscience/api exec prisma generate && pnpm build && pnpm lint && pnpm typecheck
&& pnpm test`. Awaiting that local verification and your approval before Phase 3 Step 4. Do not
begin Phase 3 Step 4 until that approval lands.

**Phase 3 — Dashboard & Workspace, Step 4 (Workspace Frontend Experience): implemented and
Phase 3 is now complete.** Frontend-only — no backend files changed. See
`claude/CURRENT_PHASE.md`'s "Phase 3 Step 4" section for full detail.

**Phase 4 — OmniProvider & Model Manager, Step 1 (Provider Foundation & Domain Architecture):
implemented this session, fully verified in-sandbox** (this session's sandbox had working
npm/pnpm network egress). Provider-neutral registry/catalog/deterministic-selector foundation
only — no real vendor SDK, no real external AI API call anywhere in this step. Three
metadata-only stub provider descriptors (Gemini, OpenAI, Anthropic) were included by explicit
approval so the new `GET /ai/providers`/`GET /ai/models` diagnostic endpoints (both behind the
existing `JwtAuthGuard`) have real, non-empty content; every execution method
(`generateText`/`generateStructured`/`embed`) throws a typed `NOT_IMPLEMENTED` domain error
rather than calling any vendor. New shared types (`packages/types/src/ai-provider.ts`) and
request schemas (`packages/schemas/src/ai-provider.ts`); three new, fully independent, optional
env vars (`GEMINI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` — never mandatory, never
crash-on-absence, never logged); a new `apps/api/src/ai/` module (`ProviderRegistryService`,
`ModelCatalogService`, `ModelSelectorService`, the three stub provider classes, a bootstrap seed
service, and `AiController`), registered into `app.module.ts`. Selection is deterministic and
depends only on capabilities/availability/provider-readiness/priority/preferred-provider/
preferred-model — never a hardcoded vendor name; see `claude/CURRENT_PHASE.md`'s "Phase 4 Step 1"
section for the exact algorithm, architecture, security decisions, and deferred work. **Verified
this session:** `pnpm install --frozen-lockfile` (818 packages), `pnpm build`/`lint`/`typecheck`
all green across all 9 packages, `pnpm test` green across the full monorepo — 666/666 tests
passing (`@omniscience/api` 330/330 across 42 suites, every pre-existing Phase 0–3 spec/e2e-spec
unchanged and still green). Two real, self-authored bugs were caught and fixed in-session (not
reported as pre-existing or masked): a stub-provider method-signature mismatch caught by
`tsc`, and a test-fixture-naming false positive in the "never leaks a credential" test caught by
`jest` — both detailed in `claude/CURRENT_PHASE.md`'s Verification section. `prisma generate`
still cannot reach `binaries.prisma.sh` in this sandbox (same standing limitation as every prior
session); irrelevant here, since this step makes no Prisma schema changes. Awaiting your review
and approval before Phase 4 Step 2.

**Phase 4 — OmniProvider & Model Manager, Step 2 (Anthropic Real Execution — `generateText`
only): implemented this session, fully verified in-sandbox.** Anthropic is now the first *real*
`OmniProvider` adapter — `generateText` makes a genuine `@anthropic-ai/sdk` call, injected via a
new `ANTHROPIC_CLIENT` DI token so production resolves a real SDK client while every test injects
a fake one (no live vendor network call in any test). `generateStructured`/`embed` remain
`NOT_IMPLEMENTED`; Gemini and OpenAI are untouched Step 1 metadata-only stubs. Four adjustments
were required to Claude's own proposed scope before implementation began, all applied: no
provider-local circuit breaker (readiness stays configuration-only, exactly Step 1's check); no
custom retry loop (retries are handled entirely by the official SDK's own `timeout`/`maxRetries`
options, sourced from two new optional env vars, `AI_REQUEST_TIMEOUT_MS`/`AI_MAX_RETRIES`); the
SDK client is DI-injectable via a token rather than constructed inline; and pre-execution
validation checks credential presence (`PROVIDER_NOT_CONFIGURED`) then model registration/
ownership (`MODEL_NOT_FOUND` — a single membership check against Anthropic's own static model
list rejects both unknown ids and ids belonging to a different provider). Six new domain error
codes normalize every SDK failure category (auth, rate-limit, timeout, invalid-request,
unavailable, invalid-response) — the raw SDK error message/body/headers are never forwarded to a
caller. Anthropic's advertised capabilities were trimmed to `text-generation` only, since Step 1
had claimed `structured-output`/`vision`/`tool-calling` with nothing backing those claims once
real execution exists. No new public HTTP endpoint was added. See `claude/CURRENT_PHASE.md`'s
"Phase 4 Step 2" section for the exact adjustments, architecture, security summary, and deferred
work. **Verified this session:** `pnpm install` (824 packages), `pnpm build`/`lint`/`typecheck`
all green across all 9 packages, `pnpm test` green across the full monorepo —
`@omniscience/api` 44/44 suites, 357/357 tests (up from Step 1's 330/330). Two real,
self-authored issues were caught and fixed in-session (not masked or reported as pre-existing): a
test-fixture typing issue (`jest.Mocked<AnthropicMessagesClient>` didn't deep-map the nested
`messages.create` mock as expected — fixed with an explicit fake-client interface) and one wrong
expected-value in a new multi-text-block-joining test (the implementation was already correct).
`@anthropic-ai/sdk@^0.112.4` is the only new dependency; its real error-class hierarchy, response
shapes, and client-constructor behavior were confirmed via a standalone scratch-directory install
before any implementation code was written against them, rather than assumed from training data.
`prisma generate` was not re-run this session (no Prisma schema change; same standing
`binaries.prisma.sh` limitation as every prior session, unrelated to this step). Awaiting your
review and approval before Phase 4 Step 3.

**Phase 4 — OmniProvider & Model Manager, Step 3 (`POST /ai/generate`): implemented this
session, fully verified in-sandbox.** The first public endpoint that actually executes a model:
`AiController` → new `AiService.generate()` → `ModelSelectorService.select()` →
`ProviderRegistryService` lookup → `OmniProvider.generateText()`. The public request body is
just `{ prompt: string }` (`.strict()` `generateTextRequestSchema` — trimmed, 1–8000 chars,
unknown fields rejected); `AiService` is the only place `requiredCapabilities: ["text-generation"]`
is set — a caller can never send `requiredCapabilities`/`preferredProviderId`/`preferredModelId`
directly, since sending any of them now fails validation instead of being silently accepted. The
public response is `{ text, providerId, modelId }` only — `matchedRule` and every other internal
routing/debug field is deliberately excluded.

The core architectural risk flagged in the approved scope — "a configured API key must never
cause a metadata-only stub provider to be selected for real execution and then fail with
`NOT_IMPLEMENTED`" — was real: Gemini/OpenAI's Step 1 stub descriptors advertise `text-generation`
on `available` models with lower `priority` numbers than Anthropic's, so setting e.g.
`GEMINI_API_KEY` alone would have made `isReady()` return `true` and the old selector would have
routed a real request straight into a stub's `NOT_IMPLEMENTED` throw. Fixed with one new,
vendor-neutral interface method: `OmniProvider.supportsExecution(capability): boolean`.
`StubProviderDescriptor` (Gemini/OpenAI's shared base) always returns `false`; `AnthropicProvider`
overrides it to return `true` only for `"text-generation"` (still `false` for anything else, since
`generateStructured`/`embed` remain unimplemented). `ModelSelectorService.isEligible()` now
requires `provider.supportsExecution(capability)` for every required capability, in addition to
the existing capability/availability/readiness checks — a stub can never be selected for real
execution again, regardless of what its own metadata or a caller's preference says.

No vendor name, provider id, or model id is hardcoded anywhere in `AiService` or the selector
change — both remain generic over the `OmniProvider` interface. `@Throttle({ default: { limit:
10, ttl: 600_000 } })` was added to the new route specifically because, unlike the two existing
`GET` diagnostics, every call is vendor-billed. See `claude/CURRENT_PHASE.md`'s "Phase 4 Step 3"
section for the exact architecture, security summary, and deferred work.

**Verified this session:** `pnpm install` (824 packages, same standing `@prisma/client`
postinstall-checksum limitation as every prior session), `pnpm build`/`lint`/`typecheck` all green
across all 9 packages (one real lint bug caught and fixed in-session: an unused `os` import left
over from an earlier draft of the new e2e spec), `pnpm test` green across the full monorepo — 726
tests passing, 0 failing (`@omniscience/api` 46/46 suites, 378/378 tests, up from Step 2's
44/357). New coverage this step: `ai.service.spec.ts` (new), execution-eligibility unit tests
added to `model-selector.service.spec.ts`, `supportsExecution` assertions added to
`stub-providers.spec.ts` and `anthropic.provider.spec.ts`, `POST /ai/generate` coverage added to
`ai.controller.spec.ts`, an `AiService` resolution check added to `ai.module.spec.ts`, new
`generateTextRequestSchema` tests in `packages/schemas`, and a new e2e spec
(`test/ai-generate.e2e-spec.ts`) exercising the real `JwtAuthGuard`/`ThrottlerGuard`/
`ZodValidationPipe` stack plus the full selector→registry→provider path against a fake injected
`ANTHROPIC_CLIENT` — no test in the repository makes a live vendor network call.
`prisma generate` was not re-run this session (no Prisma schema change; same standing
`binaries.prisma.sh` limitation).

**Phase 4 — OmniProvider & Model Manager, Step 4 (Google Gemini Real Execution): implemented this
session, per your approved scope ("Integrate Google Gemini as the second real execution-capable AI
provider", backend only).** `GeminiProvider` (`apps/api/src/ai/providers/gemini.provider.ts`) is
now a real adapter — `generateText` makes a genuine `@google/genai` `models.generateContent` call
via a new injected `GEMINI_CLIENT` token (`gemini-client.provider.ts`, mirroring
`anthropic-client.provider.ts`); a new `gemini-error-mapper.ts` normalizes `@google/genai`'s single
`ApiError` class (branched on HTTP `status`, since unlike `@anthropic-ai/sdk` it has no
distinct-subclass-per-status hierarchy) plus timeout detection into the same
`AiDomainErrorCode`s Anthropic already uses. `capabilities`/`supportsExecution` are trimmed to
`text-generation` only, identical to Anthropic's own Step 2 trimming; `generateStructured`/`embed`
remain `NOT_IMPLEMENTED`. The two registered models were updated from Step 1's now-discontinued
`gemini-1.5-flash`/`gemini-1.5-pro` placeholders to current, callable `gemini-3.5-flash`/
`gemini-2.5-pro`. `ModelSelectorService`, `AiService`, `AiController`, and every frontend file are
completely unchanged — Gemini slots in purely through the existing `OmniProvider` interface, no new
abstraction. `stub-providers.spec.ts` had `GeminiProvider` removed from its shared stub suite (same
treatment `AnthropicProvider` got in Step 2); new dedicated `gemini.provider.spec.ts` and
`gemini-error-mapper.spec.ts` were added, and `ai-generate.e2e-spec.ts` gained a Gemini-only
success e2e case alongside the existing Anthropic one. See `claude/CURRENT_PHASE.md`'s "Phase 4
Step 4" section for the full changed-file list, architecture/security summary, and deferred items.
**Not verified with a real `pnpm install`/`build`/`lint`/`typecheck`/`test` run from this sandbox
this session** — no working npm/pnpm network egress for the newly-added `@google/genai` dependency
in this environment this session; reviewed manually against the real, currently-published
`@google/genai` package's own TypeScript type declarations instead (installed and inspected
directly to confirm the SDK's exact shapes). **You must run `pnpm install --frozen-lockfile`/`pnpm
build`/`pnpm lint`/`pnpm typecheck`/`pnpm test` locally and report the result before this is
committed.** Do not begin Phase 4 Step 5 until that verification, your local confirmation, and
ChatGPT's senior review all land.

**Post-verification fix (same session):** a real local run with an invalid `GEMINI_API_KEY`
exposed that `mapGeminiError` fell through to `PROVIDER_UNAVAILABLE` instead of
`PROVIDER_AUTH_FAILED`, because the thrown error did not satisfy `error instanceof ApiError`.
`gemini-error-mapper.ts` was rewritten to classify by structural shape (a numeric `status` read off
the error itself or up to five levels of `.cause`) instead of nominal class identity, and a second,
Gemini-specific quirk was fixed alongside it: Google's backend commonly returns a 400 (not 401/403)
for an invalid key, with a message like "API key not valid" — a 400 is now checked internally
against known auth-failure wording before falling back to `PROVIDER_REQUEST_INVALID`.
`gemini-error-mapper.spec.ts` gained a regression suite covering all of the above. No other file
changed. `pnpm typecheck`/`lint`/`build`/`test` were rerun after this fix, all green — see
`claude/CURRENT_PHASE.md`'s "Post-verification fix" subsection for full detail and results.

**Post-verification fix #2 (same session):** a further real local run (`GEMINI_API_KEY=not-configured`,
`ANTHROPIC_API_KEY` unset) showed the *same* `PROVIDER_UNAVAILABLE` response even after fix #1 above
— proving the mapper rewrite, while a real improvement, was not the actual root cause. Tracing the
exact installed `@google/genai@2.13.0` bundle found it: `gemini-client.provider.ts`'s
`httpOptions.retryOptions` (added to honor `AI_MAX_RETRIES`) makes the SDK route every request
through its bundled `p-retry@4.6.2` dependency instead of its own informative `ApiError` path — and
`p-retry` unwraps a non-retryable failure to a **plain `Error`** with no `.status`, no `.cause`, and
only a bare HTTP reason phrase in its message (e.g. `"Non-retryable exception Bad Request sending
request"`), for *every* status code, not just auth failures. `httpOptions.retryOptions` has been
removed entirely from `gemini-client.provider.ts` (timeout handling via `AI_REQUEST_TIMEOUT_MS` is
unaffected and preserved); `mapGeminiError` gained a defense-in-depth fallback recognizing that exact
lossy message shape, in case `retryOptions` is ever reintroduced by accident; and
`gemini-error-mapper.spec.ts` gained a dedicated regression suite for it. `pnpm
typecheck`/`lint`/`build`/`test` were rerun after this fix, all green — see `claude/CURRENT_PHASE.md`'s
"Post-verification fix #2" subsection for the full trace and results. **New deferred item:** an
external, response-status-aware retry loop for Gemini, since the SDK's own retry mechanism is no
longer used.

**Phase 4 — OmniProvider & Model Manager, Step 5 (Production Hardening — final Phase 4 step):
implemented this session, per your approved scope** (a complete production-hardening review of the
AI provider layer — provider abstraction consistency, selection logic, config validation,
health/status reporting, timeout behavior, error normalization, logging quality, maintainability,
extensibility, technical-debt removal, remaining edge cases — small, justified improvements only,
no breaking changes, no architecture redesign). Every file in `apps/api/src/ai/` was read end to
end before any change; `packages/config/src/env.ts` and `packages/schemas/src/ai-provider.ts` were
also reviewed and found already solid (no change needed). What changed: a new
`provider-error-utils.ts` shares the structural error-detection logic
(`extractStatusInfo`/`isTimeoutErrorByName`) Step 4's post-verification fixes added for Gemini,
now also used by `anthropic-error-mapper.ts` as a defense-in-depth fallback after its existing
`instanceof` chain (unchanged, still primary) — closing an inconsistency where only one of the two
real adapters had this resilience. Both mappers gained an optional `logger` parameter that
warn-logs a secret-free structural fingerprint (never the raw message) only when every
classification attempt fails — exactly what would have surfaced Step 4's original incident
immediately in production logs. `GeminiProvider`/`AnthropicProvider` both gained an optional,
`@Optional()`-injected `LOGGER`, forwarded to their mapper calls, so every existing test
constructing either class with just `(env, client)` is unaffected. `AiProviderSeedService` now
logs an info-level provider-registration summary (ids + `configStatus()`, never a credential) at
boot, and a warn if zero registered providers are both ready and genuinely execution-capable —
directly useful in this session's environment (Anthropic present but out of credits; Gemini
configured), verified to correctly warn only when *no* provider is usable. `AiService` now logs
the selected provider/model at debug on success only (deliberately not on failure, since
`AllExceptionsFilter` already logs every error centrally — avoiding double-logging). A small
`ProviderRegistryService.tryGetById()` replaced a duplicated linear-scan lookup in
`ModelSelectorService`. No public API contract, response shape, or existing classification
behavior changed. New tests: `provider-error-utils.spec.ts`, `ai-provider-seed.service.spec.ts`,
plus new `describe` blocks in five existing spec files. `pnpm install`/`typecheck`/`lint`/`build`/
`test` were all actually run in-sandbox this session — all green, including a real typecheck catch
(the logger param was initially typed as the full pino `Logger`, narrowed to `Pick<Logger, "warn">`
to match actual usage and fix a test-fake incompatibility). `@omniscience/api`: 50 suites / 465
tests (up from Step 4's 419). Full monorepo: 767 tests, all green. See `claude/CURRENT_PHASE.md`'s
"Phase 4 Step 5" section for the full changed-file list, what was reviewed and deliberately left
unchanged, security considerations, and deferred items. **This is Phase 4's final step — Phase 5
has not been started.**

**Phase 5 — OmniCore, Step 1 (OmniCore Foundation): complete.** The foundation of OmniCore, the
platform's orchestration layer described in `docs/04_System_Architecture.md`'s `User → Assistant →
OmniCore → OmniProvider/Model Manager` flow. Introduces `POST /omnicore/execute` (behind the same
`JwtAuthGuard` and vendor-billed `@Throttle` shape as `POST /ai/generate`), a new
`apps/api/src/omnicore/` module (`FastRulesEngineService`, `CapabilityPlanBuilderService`,
`OmniCoreService`, `OmniCoreController`), and OmniCore's own typed domain-error architecture
(`omnicore.errors.ts`). `OmniCoreService.execute()` composes classification → a `CapabilityPlan` →
`ModelSelectorService`/`ProviderRegistryService` (reused as-is from Phase 4, no new provider or
model registered) → `OmniProvider.generateText()`. The public response returns only safe routing
metadata (`planId`, `intent`, `matchedRuleId`, `confidence`, `providerId`, `modelId`, `text`) —
never an internal plan or selector-rule detail. See `claude/CURRENT_PHASE.md`'s "Phase 5 Step 1"
section for further detail.

**Phase 5 — OmniCore, Step 2 (Intent Intelligence): complete.** Replaces Step 1's placeholder
classification with `FastRulesEngineService`'s real deterministic rule set: a fixed
`ResolvedOmniCoreIntent` taxonomy (`simple-generation`, `question-answering`, `code-generation`,
`summarization`, `creative-writing`), each rule scoring a trimmed prompt in `[0, 1]` with no model
call involved (a heuristic, not an inference — hence "fast"). A confidence-margin check between the
top two candidate rules yields a synthetic `"ambiguous"` intent when the request is genuinely
unclear between two or more of the above, surfaced to the caller as a `422 AMBIGUOUS_INTENT` with
the candidate `alternateIntents` — never guessed at silently. `CapabilityPlanBuilderService` gained
a real per-intent `INTENT_CAPABILITY_MAP` (every entry still resolves to `"text-generation"` today,
since that remains the only capability any registered `OmniProvider` genuinely executes) and
refuses to build a plan for an `"ambiguous"` match. See `claude/CURRENT_PHASE.md`'s "Phase 5 Step 2"
section for further detail.

**Phase 5 — OmniCore, Step 3 (Task Planning Engine): implemented this session, fully verified
in-sandbox.** A production-grade planning layer that converts a `CapabilityPlan` into a validated,
dependency-ordered, execution-ready `TaskPlan` — new shared types
(`packages/types/src/omnicore-plan.ts`: `TaskPlanStep`, `ExecutionStage`, `TaskPlan`,
`TaskComplexity`, `StepFailurePolicy`) and five new `apps/api/src/omnicore/` services
(`DependencyGraphService`, `PlanValidatorService`, `ComplexityEstimatorService`,
`ExecutionStageBuilderService`, `TaskPlannerService`). `DependencyGraphService` validates every
step's `dependsOn` references (rejecting duplicate ids, missing references, and circular
dependencies) and computes a topological layering; `ExecutionStageBuilderService` turns that
layering into `TaskPlan.stages`, marking a single-step layer `"sequential"` and a multi-step
independent layer `"parallel"`; `ComplexityEstimatorService` classifies `low`/`medium`/`high`/
`very-high` per step and per plan from plan shape alone (no model call); `TaskPlannerService` is
the seam that builds a `TaskPlan` from an existing `CapabilityPlan` without duplicating
`CapabilityPlanBuilderService`'s own capability-selection logic. `OmniCoreExecuteResponse` gained an
additive `taskPlan` field — every pre-existing field is unchanged. Six new domain error codes
(`INVALID_TASK_PLAN`, `CIRCULAR_DEPENDENCY`, `MISSING_DEPENDENCY`, `DUPLICATE_STEP_ID`,
`UNSUPPORTED_CAPABILITY_MAPPING`, `PLANNING_FAILED`), all `422`. Every resolved intent still
compiles to exactly one `TaskPlanStep` today (Step 2's classifier is single-shot), so the
multi-step/parallel machinery is exercised directly via hand-built fixtures in each new service's
own unit tests, ready for a future multi-step decomposition without a redesign. **Verified this
session:** `pnpm typecheck`/`lint`/`build`/`test` all green across all 9 packages;
`@omniscience/api` 60 suites / 560 tests (up from Phase 4 Step 5's 465). See
`claude/CURRENT_PHASE.md`'s "Phase 5 Step 3" section for the full architecture, error-code
rationale, and deferred work (multi-step decomposition and actual orchestration, both explicitly
deferred to Step 4).

**Phase 5 — OmniCore, Step 4 (Execution Orchestration Engine): implemented this session, fully
verified in-sandbox.** Consumes Step 3's `TaskPlan` and actually runs it — new
`ExecutionOrchestratorService` walks `TaskPlan.stages` in order (sequential stages one step at a
time, parallel stages concurrently via `Promise.all`, safe by construction since
`DependencyGraphService` already guarantees no same-stage step depends on another), and a new
`StepExecutorService` runs one `TaskPlanStep` through the existing `ModelSelectorService`/
`ProviderRegistryService` path — the same call `OmniCoreService` used to make directly before this
step. New shared types (`packages/types/src/omnicore-execution.ts`: `ExecutionStatus`,
`StepExecutionResult`, `StageExecutionResult`, `PlanExecutionResult`), attached to
`OmniCoreExecuteResponse` as a second additive field, `execution`, alongside the untouched
`taskPlan`. Only the `"abort"` failure policy is implemented — the first step failure, timeout, or
cancellation stops the whole plan and lets the original, already-typed error propagate unchanged,
architected so a future `"continue"`/`"retry"` policy only changes that one branch. Internal
timeout/cancellation support is in-process only (an `AbortSignal` plus an optional `timeoutMs`) —
no persistent job queue. Eight new domain error codes (`UNSUPPORTED_CAPABILITY`,
`DEPENDENCY_FAILURE`, `INVALID_EXECUTION_STATE`, `PLAN_EXECUTION_FAILED`, `STAGE_EXECUTION_FAILED`,
`STEP_EXECUTION_FAILED`, `EXECUTION_TIMEOUT`, `EXECUTION_CANCELLED`). `OmniCoreService.execute()`
now composes classify → capability plan → task plan → orchestrate, deriving `text`/`providerId`/
`modelId` from the orchestrator's step result. **Verified this session:** `pnpm
typecheck`/`lint`/`build`/`test` all green across all 9 packages; `@omniscience/api` 62 suites /
580 tests (up from Step 3's 560). See `claude/CURRENT_PHASE.md`'s "Phase 5 Step 4" section for the
full architecture and deferred work (`"continue"`/`"retry"` failure policies, distributed workers/
queues, persistent execution storage — all deferred to a later phase).

**Phase 5 — OmniCore, Step 5 (Tool Calling Framework): implemented this session, fully verified
in-sandbox — this is the foundation for future RAG, search, memory, web, and database
integrations, none of which are built yet.** A generic `Tool<TInput, TOutput>` contract
(`apps/api/src/omnicore/tools/tool.interface.ts`) mirroring `OmniProvider`'s own split — the
executable interface lives in `apps/api`, structurally typed (`ToolSchema<T>` with `safeParse`,
"ZodLike" rather than a direct `zod` dependency, same convention `ZodValidationPipe` already uses)
so input/output validation is real and enforced, not just declared. New `ToolRegistryService`
(register/getById/tryGetById/list, mirroring `ProviderRegistryService`) and `ToolExecutorService`
(validate input → run, raced against timeout/cancellation → validate output → typed
`ToolExecutionResult`), plus a shared `execution-timeout.util.ts` extracted from Step 4's
`StepExecutorService` so both reuse the identical race logic. Three foundation built-in tools —
`EchoTool`, `CurrentTimeTool`, `UUIDTool` — registered at bootstrap by a new `ToolSeedService`
(`OnModuleInit`, mirroring `AiProviderSeedService`). `StepExecutorService` now routes on
`TaskPlanStep.toolCategory` (a field that already existed since Step 3): set → `ToolExecutorService`;
unset → the existing model path, unchanged. No real `TaskPlan` sets `toolCategory` yet (Step 2's
capability plan builder never produces one), so tool-routed step execution is exercised directly
via unit tests, the same "generic machinery ahead of its real producer" precedent Steps 3/4 already
established. Six new domain error codes (`TOOL_NOT_FOUND`, `DUPLICATE_TOOL_ID`,
`INVALID_TOOL_INPUT`, `TOOL_EXECUTION_FAILED`, `TOOL_TIMEOUT`, `TOOL_CANCELLED`). New shared types
(`packages/types/src/tool.ts`: `ToolCapability`, `ToolMetadata`, `ToolExecutionResult`); a new
optional `toolId` field on `StepExecutionResult`. **Verified this session:** `pnpm
typecheck`/`lint`/`build`/`test` all green across all 9 packages; `@omniscience/api` 69 suites /
624 tests (up from Step 4's 580). See `claude/CURRENT_PHASE.md`'s "Phase 5 Step 5" section for the
full architecture and deferred work (external APIs, web search, RAG, databases, memory, MCP — none
built yet; only the generic framework and three foundation tools exist).

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

**Phase 6 — Omniscience Assistant, Step 1 (Conversation & Message Persistence Foundation):
implemented this session** on top of the completed Phase 0-5 foundation (Phase 4 — OmniProvider &
Model Manager, and Phase 5 — OmniCore Steps 1-5, all already complete per the checklist below).
Delivers `MongoModule`/`MongoService` (the first module to actually use the long-provisioned but
previously untouched `MONGO_URL`) and a new `ConversationsModule` — five endpoints
(`POST`/`GET /workspaces/:workspaceId/conversations`,
`GET /workspaces/:workspaceId/conversations/:conversationId`,
`GET`/`POST /workspaces/:workspaceId/conversations/:conversationId/messages`) that create/list/get
workspace-owned conversations and send/list messages, routing `POST .../messages` through the
existing `OmniCoreService.execute()` pipeline directly via dependency injection (never through the
HTTP boundary). Required exporting `WorkspacesService` from `WorkspacesModule` and `OmniCoreService`
from `OmniCoreModule` (both were already providers, just not previously exported) — the only places
this step touches already-completed Phase 3/5 code, and purely additive, same "widening an
`exports` array cannot change existing behavior" reasoning Phase 2 Step 8's `RefreshTokenStore`
export already established. If OmniCore execution fails, the already-persisted user message stays
persisted and no assistant message is ever created — the OmniCore domain error propagates
unchanged. **Unlike every prior session referenced above, this sandbox had *no* network egress at
all** — not `pnpm`/`corepack`, not a direct `npm install -g`, not even a bare `curl` to
`registry.npmjs.org` (all fail identically with `x-deny-reason: host_not_allowed` / HTTP 403), and
no `node_modules` exists in the extracted archive — so `pnpm install`/`build`/`lint`/`typecheck`/
`test` and `docker compose up -d` (for `conversations.repository.spec.ts`'s real-Mongo suite) could
not be run at all this session, not even partially. In their place, every new file's imports,
types, and reused error/response shapes were manually cross-checked line-by-line against the
actual exported symbols and shapes in the modules they reuse (`WorkspacesService.getById()`'s exact
exception shape, `OmniCoreExecuteResponse`'s exact field names, `ai-generate.e2e-spec.ts`'s exact
`ANTHROPIC_CLIENT`-override technique) — this cross-check is what caught the two missing exports
above. See `claude/CURRENT_PHASE.md`'s "Phase 6 — Omniscience Assistant, Step 1" section for the
full implementation summary and the exact commands **you must run locally** before this step is
considered verified: `pnpm install --frozen-lockfile`, `pnpm --filter @omniscience/api exec prisma
generate`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` (checking that
`conversations.repository.spec.ts` actually connects to real Mongo rather than self-skipping), and
`docker compose up -d` plus a manual HTTP smoke test. This is Phase 6 Step 1; no further Phase 6
step has been started.

## Repository Rule

After Phase 0, always continue from the latest working repository. Never create an unrelated
replacement project. Do not modify completed-phase architecture without an explicit instruction to
do so.

---

# Future Locked Vision – Arceus Activation Mode

## Status

**Planning Complete**

Implementation Status: **Not Started**

This feature is permanently reserved as the final major engineering phase of **The Omniscience Platform**.

It must not begin until all currently planned platform phases have been completed, reviewed, tested, documented, and stabilized.

---

## Overview

Arceus Activation Mode represents the long-term evolution of The Omniscience Platform from an advanced AI application into a secure, user-authorized AI operating layer.

The feature introduces optional voice-driven interaction while preserving the platform's existing text-first experience.

This capability is inspired only by the interaction philosophy of cinematic AI assistants and does not attempt to reproduce copyrighted characters, branding, voices, or implementations.

Arceus remains an original product identity.

---

## Reserved Wake Phrase

The reserved activation phrase is:

> **Activate Arceus**

This wake phrase is permanently reserved for the future implementation.

---

## Dual Interaction Principle

The Omniscience Platform will always support two complementary interaction styles.

### Standard Platform Mode

The existing experience remains unchanged.

Users continue interacting through:

- Keyboard
- Mouse
- Touch
- Web UI
- Desktop UI
- Mobile UI

Every capability developed throughout the earlier roadmap continues to function normally.

---

### Arceus Activation Mode

Voice interaction becomes an additional capability.

After the wake phrase:

> **Activate Arceus**

users may naturally interact through speech.

The platform supports:

- Voice-only interaction
- Text-only interaction
- Hybrid voice + text interaction

Both interaction methods share the exact same conversation, memory, permissions, reasoning, and orchestration systems.

There is only one Arceus intelligence layer.

---

## Architectural Direction

The future implementation must reuse the mature platform architecture rather than introducing a separate AI system.

This includes reuse of:

- Authentication
- Workspace isolation
- Conversation engine
- Memory
- Provider abstraction
- Model selection
- Agent orchestration
- Tool routing
- Logging
- Audit history
- Observability
- Error handling

Voice is an interface layer, not a second assistant.

---

## Long-Term Goal

When the entire Omniscience Platform roadmap has been completed, Arceus Activation Mode becomes the platform's flagship capability.

Its objective is to provide secure, permission-based AI assistance across desktop, mobile, and cloud environments while maintaining transparency, user control, accessibility, and enterprise-grade security.

Complete implementation details are maintained in:

**`claude/ARCEUS_ACTIVATION_VISION.md`**

This document is considered the authoritative long-term vision for the feature.

---

## Current Status

- Phase 4: ✅ Complete
- Phase 5, Step 1 (OmniCore Foundation): ✅ Complete
- Phase 5, Step 2 (Intent Intelligence): ✅ Complete
- Phase 5, Step 3 (Task Planning Engine): ✅ Complete
- Phase 5, Step 4 (Execution Orchestration Engine): ✅ Complete
- Phase 5, Step 5 (Tool Calling Framework): ✅ Complete
- Phase 6, Step 1 (Conversation & Message Persistence Foundation): ⚠️ Implemented this session;
  runtime verification (`pnpm install`/`typecheck`/`lint`/`build`/`test`, real MongoDB) pending —
  this sandbox has no network egress at all. See `claude/CURRENT_PHASE.md`'s "Phase 6 — Omniscience
  Assistant, Step 1" section for the full implementation summary, what was manually cross-checked
  in place of running the tools, and the exact commands a maintainer with network access must run
  before this step is marked complete.
- Arceus Activation Mode: 🔒 Locked Future Phase (Not Started)

No implementation work for Arceus Activation Mode should begin until the planned platform roadmap has reached its intended completion.