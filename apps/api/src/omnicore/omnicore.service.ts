import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import type { OmniCoreExecuteResponse } from "@omniscience/types";
import { LOGGER } from "../config/config.constants";
import { CapabilityPlanBuilderService } from "./capability-plan-builder.service";
import { ExecutionOrchestratorService } from "./execution-orchestrator.service";
import { FastRulesEngineService } from "./fast-rules-engine.service";
import { omniCoreDomainError } from "./omnicore.errors";
import { TaskPlannerService } from "./task-planner.service";

/**
 * `OmniCoreService` — OmniCore's orchestration entry point (Phase 5
 * Steps 1-4), implementing the flow `docs/04_System_Architecture.md`
 * describes: `User → Assistant → OmniCore → capability plan →
 * OmniProvider/Model Manager → specialized modules → validator/
 * reviewer → response composer`. (\"Assistant\" here is the future
 * Phase 6 Omniscience Assistant conversation layer; `POST
 * /omnicore/execute`, the same shape as Phase 4's `POST /ai/generate`,
 * stands in for it as a diagnostic entry point until that phase
 * exists.)
 *
 * `execute()`'s full pipeline, as of Step 4:
 *   1. **Intent intelligence** — `FastRulesEngineService.classify()`
 *      (Step 2) resolves the prompt to one of five concrete intents,
 *      or the synthetic `\"ambiguous\"` intent when genuinely
 *      uncertain.
 *   2. **Capability plan** — `CapabilityPlanBuilderService.build()`
 *      compiles the match into a `CapabilityPlan`, refusing to do so
 *      for `\"ambiguous\"` (`AMBIGUOUS_INTENT`).
 *   3. **Task plan** — `TaskPlannerService.plan()` (Step 3) enriches
 *      that `CapabilityPlan` into a validated, dependency-ordered,
 *      execution-ready `TaskPlan`, attached to the response as
 *      `taskPlan`.
 *   4. **Orchestration** — `ExecutionOrchestratorService.execute()`
 *      (Step 4) actually runs the `TaskPlan`'s stages/steps through
 *      `StepExecutorService`, producing a `PlanExecutionResult`,
 *      attached to the response as `execution`.
 *
 * This method still contains no `\"ambiguous\"`-specific branch, and no
 * additional try/catch of its own for anything else either: every
 * failure mode from any of the four stages above — an unrecognized or
 * ambiguous intent, an invalid task plan, no compatible model, an
 * unsupported capability, a dependency failure, a timeout, a
 * cancellation, a mapped provider error — propagates unchanged as the
 * same normalized domain error the underlying service already threw.
 * `execute()`'s job is composing those four stages in order, not
 * catching what they throw.
 *
 * The single-step guard below and the resulting `text`/`providerId`/
 * `modelId` fields are unchanged in *meaning* from Step 1-3: every
 * `CapabilityPlan` OmniCore can build today still has exactly one
 * step, so `execution.stageResults` is always exactly one stage of
 * exactly one step, and those three fields are read from that one
 * step's `StepExecutionResult` — the same value a direct
 * `selector.select()` → `provider.generateText()` call would have
 * produced, now produced via the orchestrator instead so a real
 * multi-step `TaskPlan` (a future phase) needs no change to this
 * method at all.
 */
@Injectable()
export class OmniCoreService {
  constructor(
    private readonly fastRules: FastRulesEngineService,
    private readonly planBuilder: CapabilityPlanBuilderService,
    private readonly taskPlanner: TaskPlannerService,
    private readonly orchestrator: ExecutionOrchestratorService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Classifies, plans, and executes `prompt` end to end. Every failure
   * mode propagates unchanged as the same normalized domain error the
   * underlying service/provider already threw; this method adds no
   * additional try/catch of its own (same invariant documented above
   * and in `ExecutionOrchestratorService`).
   */
  async execute(prompt: string): Promise<OmniCoreExecuteResponse> {
    const match = this.fastRules.classify(prompt);
    const plan = this.planBuilder.build(prompt, match);

    const [step, ...rest] = plan.steps;
    if (!step || rest.length > 0) {
      // Defensive guard: `CapabilityPlanBuilderService` only ever
      // produces exactly one step today. Real multi-step capability
      // plans are a future extension of that service, not this one —
      // see `TaskPlannerService`'s doc comment for why the planning
      // and orchestration layers underneath this guard are already
      // multi-step-ready regardless.
      throw omniCoreDomainError(
        "INTENT_NOT_RECOGNIZED",
        "OmniCore Step 1 supports only single-step capability plans.",
      );
    }

    // Built before orchestration so a planning failure (Phase 5 Step
    // 3's domain errors) is surfaced without ever making a real,
    // vendor-billed provider call.
    const taskPlan = this.taskPlanner.plan(plan);

    const execution = await this.orchestrator.execute(taskPlan);

    // Every `CapabilityPlan`/`TaskPlan` OmniCore builds today has
    // exactly one step, in exactly one stage — the same invariant the
    // guard above already enforces one layer up — so this lookup is
    // never ambiguous. A real multi-step `TaskPlan` is future work; see
    // this class's doc comment.
    const stepResult = execution.stageResults[0]?.stepResults[0];
    if (!stepResult || stepResult.output === undefined || !stepResult.providerId || !stepResult.modelId) {
      // Unreachable in practice: `ExecutionOrchestratorService.execute()`
      // only ever resolves after every step it ran completed
      // successfully — a failure propagates as a thrown error instead
      // (see that service's doc comment) — so a resolved `execution`
      // with a missing/incomplete step result would itself be an
      // orchestration invariant violation, not a normal outcome.
      throw omniCoreDomainError(
        "INVALID_EXECUTION_STATE",
        "Plan execution completed without a usable step result.",
        { taskPlanId: taskPlan.taskPlanId },
      );
    }

    this.logger.debug(
      {
        planId: plan.planId,
        intent: plan.intent,
        matchedRuleId: match.ruleId,
        confidence: match.confidence,
        providerId: stepResult.providerId,
        modelId: stepResult.modelId,
        taskPlanId: taskPlan.taskPlanId,
        executionDurationMs: execution.durationMs,
      },
      "omnicore: executed capability plan",
    );

    return {
      planId: plan.planId,
      intent: plan.intent,
      matchedRuleId: match.ruleId,
      confidence: match.confidence,
      text: stepResult.output,
      providerId: stepResult.providerId,
      modelId: stepResult.modelId,
      taskPlan,
      execution,
    };
  }
}
