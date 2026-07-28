import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Domain error codes for the OmniCore module (Phase 5 Steps 1-2). Kept
 * deliberately separate from `AiDomainErrorCode`
 * (`apps/api/src/ai/ai-provider.interface.ts`) — OmniCore is a
 * distinct module from OmniProvider/Model Manager, and every error it
 * can genuinely produce on its own (as opposed to one it lets
 * propagate unchanged from `ModelSelectorService`/`ProviderRegistryService`/
 * an `OmniProvider` adapter) belongs to its own vocabulary.
 *
 * `INTENT_NOT_RECOGNIZED` is a defensive guard, not a reachable path
 * today: `omniCoreExecuteRequestSchema` already rejects an empty or
 * whitespace-only prompt before `FastRulesEngineService.classify()` is
 * ever called, and every non-empty trimmed prompt matches at least the
 * `"simple-generation"` fallback rule. It exists so `FastRulesEngineService`
 * has a real, typed failure mode to fall back to if a future step's
 * rule set is restructured such that a non-empty prompt can genuinely
 * fail to match anything.
 *
 * `AMBIGUOUS_INTENT` (Phase 5 Step 2) is the reachable counterpart:
 * `FastRulesEngineService.classify()` can genuinely return an
 * `"ambiguous"` intent (see that method's doc comment for the scoring
 * rule), and `CapabilityPlanBuilderService.build()` refuses to compile
 * a `CapabilityPlan` for it — an ambiguous request is a request
 * OmniCore should ask about, not guess at. The thrown exception's
 * response body carries the candidate `alternateIntents` (via
 * `details`) so a caller can pose a real clarification question.
 */
export type OmniCoreDomainErrorCode =
  | "INTENT_NOT_RECOGNIZED"
  | "AMBIGUOUS_INTENT"
  | "INVALID_TASK_PLAN"
  | "CIRCULAR_DEPENDENCY"
  | "MISSING_DEPENDENCY"
  | "DUPLICATE_STEP_ID"
  | "UNSUPPORTED_CAPABILITY_MAPPING"
  | "PLANNING_FAILED"
  | "UNSUPPORTED_CAPABILITY"
  | "DEPENDENCY_FAILURE"
  | "INVALID_EXECUTION_STATE"
  | "PLAN_EXECUTION_FAILED"
  | "STAGE_EXECUTION_FAILED"
  | "STEP_EXECUTION_FAILED"
  | "EXECUTION_TIMEOUT"
  | "EXECUTION_CANCELLED"
  | "TOOL_NOT_FOUND"
  | "DUPLICATE_TOOL_ID"
  | "INVALID_TOOL_INPUT"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_TIMEOUT"
  | "TOOL_CANCELLED";

/**
 * The remaining six codes are Phase 5 Step 3's task-planning domain
 * errors, thrown by `PlanValidatorService`/`DependencyGraphService`
 * while `TaskPlannerService` turns a `CapabilityPlan` into a
 * `TaskPlan`. Like `INTENT_NOT_RECOGNIZED`, none of these are
 * reachable through the public `POST /omnicore/execute` request
 * today — a caller can never submit their own plan or steps
 * (`omniCoreExecuteRequestSchema` accepts only `prompt`), and every
 * `TaskPlan` OmniCore itself builds from a real `CapabilityPlan` is
 * well-formed by construction. They are defensive guards a correctly
 * restructured planner must still satisfy — and the real, reachable
 * failure mode `DependencyGraphService`/`PlanValidatorService`'s own
 * unit tests exercise directly against hand-built, deliberately
 * invalid fixtures:
 *   - `INVALID_TASK_PLAN` — the plan overall is malformed: no steps,
 *     or a step whose `capabilities` is empty.
 *   - `CIRCULAR_DEPENDENCY` — a step's `dependsOn` chain cycles back
 *     to itself.
 *   - `MISSING_DEPENDENCY` — a step's `dependsOn` references a
 *     `stepId` that doesn't exist in the plan.
 *   - `DUPLICATE_STEP_ID` — two steps share the same `stepId`.
 *   - `UNSUPPORTED_CAPABILITY_MAPPING` — a step requires a
 *     `ModelCapability` `CapabilityPlanBuilderService`'s intent map
 *     never produces, i.e. one that could not have been derived from
 *     a real `CapabilityPlan`.
 *   - `PLANNING_FAILED` — a catch-all for a planning failure that
 *     doesn't fit any of the above, kept distinct from
 *     `INTENT_NOT_RECOGNIZED` so a caller can tell "OmniCore couldn't
 *     even classify this" apart from "OmniCore classified this but
 *     failed to plan its execution."
 */

/**
 * Centralizes the HTTP status for each domain code, same convention as
 * `AI_DOMAIN_ERROR_STATUS` in `ai-provider.interface.ts` — so it can
 * never drift between call sites. Every code is `422 Unprocessable
 * Entity`: in every case the request itself was well-formed (it
 * already passed schema validation) but OmniCore cannot act on it as
 * given — because nothing matched, because too much did, or because
 * the plan it tried to build or run internally failed one of its own
 * invariants.
 *
 * The final eight codes are Phase 5 Step 4's execution-orchestration
 * domain errors, thrown by `StepExecutorService`/`ExecutionOrchestratorService`
 * while actually running a `TaskPlan`:
 *   - `UNSUPPORTED_CAPABILITY` — a step requires a `ModelCapability`
 *     this phase has no execution path for. Defensive today —
 *     `PlanValidatorService` (Step 3) already restricts every
 *     `TaskPlanStep.capabilities` to ones this phase supports before a
 *     `TaskPlan` can exist at all — but `StepExecutorService` checks
 *     again itself rather than trusting that upstream guarantee,
 *     exactly as `CapabilityPlanBuilderService`/`PlanValidatorService`
 *     already re-check each other's invariants instead of only one of
 *     them enforcing it.
 *   - `DEPENDENCY_FAILURE` — a step's `dependsOn` step did not
 *     complete successfully before this step was about to run.
 *     Defensive: the `"abort"` failure policy this phase implements
 *     already halts the whole plan the moment any step fails, so no
 *     later step is ever reached with a failed dependency in practice
 *     — this is the same invariant `ExecutionOrchestratorService`
 *     re-checks before every step regardless.
 *   - `INVALID_EXECUTION_STATE` — the `TaskPlan` handed to the
 *     orchestrator is internally inconsistent (e.g. a stage names a
 *     `stepId` absent from `TaskPlan.steps`) in a way Step 3's own
 *     `PlanValidatorService`/`DependencyGraphService` should have
 *     already prevented. A catch-all invariant guard, not a normal
 *     failure mode.
 *   - `PLAN_EXECUTION_FAILED` / `STAGE_EXECUTION_FAILED` /
 *     `STEP_EXECUTION_FAILED` — catch-alls for an orchestration-internal
 *     failure that doesn't fit any of the above, kept distinct from
 *     each other so a caller (and a log line) can tell which level of
 *     the plan/stage/step hierarchy the internal failure was detected
 *     at. Like `PLANNING_FAILED`, these are not how a normal step
 *     failure (e.g. a provider error) reaches the caller — that
 *     propagates unchanged, exactly as it did before this phase (see
 *     `ExecutionOrchestratorService`'s doc comment).
 *   - `EXECUTION_TIMEOUT` — a step did not complete within its
 *     configured time budget. Real and reachable whenever a timeout is
 *     configured.
 *   - `EXECUTION_CANCELLED` — execution was stopped in response to an
 *     external cancellation signal. Real and reachable whenever a
 *     caller supplies one.
 *
 * The final six codes are Phase 5 Step 5's tool-calling domain errors,
 * thrown by `ToolRegistryService`/`ToolExecutorService`
 * (`apps/api/src/omnicore/tools/`) — deliberately their own vocabulary
 * rather than reusing `EXECUTION_TIMEOUT`/`EXECUTION_CANCELLED`, so a
 * caller (and a log line) can always tell "a model step timed out/was
 * cancelled" apart from "a tool call timed out/was cancelled" even
 * though the underlying race logic (`execution-timeout.util.ts`) is
 * shared between them:
 *   - `TOOL_NOT_FOUND` — `ToolRegistryService.getById()` was asked for
 *     a tool id nothing is registered under. Real and reachable
 *     whenever a `TaskPlanStep.toolCategory` names an unregistered
 *     tool.
 *   - `DUPLICATE_TOOL_ID` — two tools were registered under the same
 *     id, the same defensive guard `ProviderRegistryService.register()`
 *     already has for `DUPLICATE_PROVIDER`. Unreachable in practice —
 *     `ToolSeedService` registers each built-in tool exactly once —
 *     but a real, typed failure mode if that ever changes.
 *   - `INVALID_TOOL_INPUT` — a tool's own `inputSchema.safeParse()`
 *     rejected the payload it was handed. Real and reachable whenever
 *     a caller (today, `StepExecutorService`) passes a tool input that
 *     doesn't match what the tool declares it accepts.
 *   - `TOOL_EXECUTION_FAILED` — a tool's `execute()` threw something
 *     that wasn't already one of this module's own typed
 *     `HttpException`s, or its result failed its own declared
 *     `outputSchema` — either way, a raw, unnormalized failure never
 *     reaches a caller as-is.
 *   - `TOOL_TIMEOUT` / `TOOL_CANCELLED` — the tool-calling counterparts
 *     to `EXECUTION_TIMEOUT`/`EXECUTION_CANCELLED`, thrown by the same
 *     shared timeout/cancellation race when it's configured for a tool
 *     call rather than a step's model call.
 */
const OMNICORE_DOMAIN_ERROR_STATUS: Readonly<Record<OmniCoreDomainErrorCode, HttpStatus>> = {
  INTENT_NOT_RECOGNIZED: HttpStatus.UNPROCESSABLE_ENTITY,
  AMBIGUOUS_INTENT: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_TASK_PLAN: HttpStatus.UNPROCESSABLE_ENTITY,
  CIRCULAR_DEPENDENCY: HttpStatus.UNPROCESSABLE_ENTITY,
  MISSING_DEPENDENCY: HttpStatus.UNPROCESSABLE_ENTITY,
  DUPLICATE_STEP_ID: HttpStatus.UNPROCESSABLE_ENTITY,
  UNSUPPORTED_CAPABILITY_MAPPING: HttpStatus.UNPROCESSABLE_ENTITY,
  PLANNING_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  UNSUPPORTED_CAPABILITY: HttpStatus.UNPROCESSABLE_ENTITY,
  DEPENDENCY_FAILURE: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_EXECUTION_STATE: HttpStatus.UNPROCESSABLE_ENTITY,
  PLAN_EXECUTION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  STAGE_EXECUTION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  STEP_EXECUTION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  EXECUTION_TIMEOUT: HttpStatus.REQUEST_TIMEOUT,
  EXECUTION_CANCELLED: HttpStatus.UNPROCESSABLE_ENTITY,
  TOOL_NOT_FOUND: HttpStatus.NOT_FOUND,
  DUPLICATE_TOOL_ID: HttpStatus.CONFLICT,
  INVALID_TOOL_INPUT: HttpStatus.BAD_REQUEST,
  TOOL_EXECUTION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  TOOL_TIMEOUT: HttpStatus.REQUEST_TIMEOUT,
  TOOL_CANCELLED: HttpStatus.UNPROCESSABLE_ENTITY,
};

/**
 * Builds the normalized `HttpException` for an OmniCore domain error.
 * `details`, added in Phase 5 Step 2, is optional and merged
 * shallowly into the response body alongside `code`/`message` — every
 * existing two-argument call site (Step 1's `INTENT_NOT_RECOGNIZED`
 * throws) is unaffected. Used today to carry `AMBIGUOUS_INTENT`'s
 * `alternateIntents` without adding a second, error-specific
 * constructor function.
 */
export function omniCoreDomainError(
  code: OmniCoreDomainErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): HttpException {
  return new HttpException({ code, message, ...details }, OMNICORE_DOMAIN_ERROR_STATUS[code]);
}
