import { Injectable } from "@nestjs/common";
import type { ModelCapability, ModelId, ProviderId, TaskPlanStep } from "@omniscience/types";
import type { OmniProvider } from "../ai/ai-provider.interface";
import { ModelSelectorService } from "../ai/model-selector.service";
import { ProviderRegistryService } from "../ai/provider-registry.service";
import { assertNotAborted, raceAgainstTimeoutAndCancellation, type RaceOptions } from "./execution-timeout.util";
import { omniCoreDomainError } from "./omnicore.errors";
import { ToolExecutorService } from "./tools/tool-executor.service";

/** Every `ModelCapability` this phase has a real execution path for. Kept in sync with `PlanValidatorService`'s `SUPPORTED_TASK_PLAN_CAPABILITIES` (Step 3) — both express the same "what can OmniCore actually run" fact, at two different points in the pipeline. */
const EXECUTABLE_CAPABILITIES: ReadonlySet<ModelCapability> = new Set<ModelCapability>(["text-generation"]);

/**
 * What a `TaskPlanStep` produced when it ran successfully. Exactly one
 * of `{providerId, modelId}` or `toolId` is ever populated — never
 * both, never neither — depending on which branch of `execute()`
 * handled the step (see that method's doc comment).
 */
export interface StepExecutionOutput {
  readonly output: string;
  readonly providerId?: ProviderId;
  readonly modelId?: ModelId;
  readonly toolId?: string;
}

/** Options controlling how a single step is run. Both are optional — omitting either runs the step with no time budget and no way to cancel it, exactly like Step 1-3's direct `provider.generateText()` call did. */
export type StepExecutionOptions = RaceOptions;

/**
 * What `executeStream()` (Phase 6 Step 2) returns once model selection
 * has already succeeded — always the model path's `{providerId,
 * modelId}` pair (streaming is not supported for tool-routed steps;
 * see that method's doc comment), plus the lazy `textStream` itself.
 * No `toolId` variant, unlike `StepExecutionOutput`.
 */
export interface StreamingStepExecutionOutput {
  readonly textStream: AsyncIterable<string>;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}

/**
 * Runs one `TaskPlanStep` to completion (Phase 5 Step 4, requirement
 * 2 "Step Execution"; extended in Phase 5 Step 5, requirement 5
 * "Execution Integration"). Routes on `step.toolCategory`:
 *
 *   - **Set** (Step 5) — the step targets a tool, not a model.
 *     `step.inputRequirements` is forwarded as-is to
 *     `ToolExecutorService.execute(step.toolCategory, ...)`, whose
 *     JSON-shaped `output` is stringified into this method's own
 *     `output: string` contract so a tool-routed step still produces
 *     exactly the same shape a model-routed step always has. No real
 *     `TaskPlan` sets `toolCategory` yet — `TaskPlannerService` never
 *     produces one — so this branch is exercised directly today, the
 *     same "generic machinery ahead of its real producer" precedent
 *     Step 3/4 already established for parallel stages and multi-step
 *     dependencies.
 *   - **Unset** (Step 1-4, unchanged) — the existing model path:
 *     `step.capabilities` is turned into an actual model call via
 *     `ModelSelectorService`/`ProviderRegistryService`, exactly as
 *     before this phase.
 *
 * Every error either branch can throw — `UNSUPPORTED_CAPABILITY`,
 * `EXECUTION_TIMEOUT`/`EXECUTION_CANCELLED` (model path),
 * `TOOL_NOT_FOUND`/`INVALID_TOOL_INPUT`/`TOOL_EXECUTION_FAILED`/
 * `TOOL_TIMEOUT`/`TOOL_CANCELLED` (tool path), or anything the
 * selector/registry/provider/tool themselves throw — propagates
 * unchanged out of `execute()`; this service adds no wrapping of its
 * own, the same invariant `OmniCoreService.execute()` already
 * documented for Step 1-4.
 */
@Injectable()
export class StepExecutorService {
  constructor(
    private readonly selector: ModelSelectorService,
    private readonly registry: ProviderRegistryService,
    private readonly toolExecutor: ToolExecutorService,
  ) {}

  async execute(step: TaskPlanStep, options: StepExecutionOptions = {}): Promise<StepExecutionOutput> {
    assertNotAborted(options.signal, "EXECUTION_CANCELLED", "Execution was cancelled before this step could start.");

    if (step.toolCategory !== undefined) {
      return this.executeToolStep(step.toolCategory, step, options);
    }
    return this.executeModelStep(step, options);
  }

  private async executeToolStep(
    toolId: string,
    step: TaskPlanStep,
    options: StepExecutionOptions,
  ): Promise<StepExecutionOutput> {
    const result = await this.toolExecutor.execute(toolId, step.inputRequirements, options);
    return { output: JSON.stringify(result.output), toolId };
  }

  private async executeModelStep(step: TaskPlanStep, options: StepExecutionOptions): Promise<StepExecutionOutput> {
    this.assertSupportedCapabilities(step);

    const { model } = this.selector.select({ requiredCapabilities: step.capabilities });
    const provider = this.registry.getById(model.providerId);
    const output = await raceAgainstTimeoutAndCancellation(
      provider.generateText(model.modelId, step.inputRequirements),
      options,
      { timeoutCode: "EXECUTION_TIMEOUT", cancelledCode: "EXECUTION_CANCELLED" },
    );

    return { output, providerId: model.providerId, modelId: model.modelId };
  }

  /**
   * The streaming counterpart to `execute()` (Phase 6 Step 2). Reuses
   * every check `execute()`'s model path already has —
   * `assertNotAborted`, capability support, `ModelSelectorService`
   * selection, `ProviderRegistryService` lookup — synchronously enough
   * that all of it still runs, and can still fail, before this
   * method's returned promise resolves. Only the final generation call
   * diverges: instead of `await`-ing `provider.generateText(...)` to
   * completion, this returns a lazy `textStream` that does not make
   * any request to the provider until it is actually iterated — so a
   * caller (`ExecutionOrchestratorService.executeStream`) can resolve
   * this promise, and therefore know model selection has already
   * succeeded, before ever opening SSE response headers.
   *
   * Tool-routed steps (`step.toolCategory` set) are not supported here
   * — there is no meaningful token-by-token delta for a tool's JSON
   * output, and no `TaskPlan` this phase produces ever sets
   * `toolCategory` in practice (see `execute()`'s own doc comment).
   * Throws the same `UNSUPPORTED_CAPABILITY` code the model path
   * already uses for a capability this phase cannot execute, rather
   * than inventing a new one, if that ever changes.
   */
  async executeStream(
    step: TaskPlanStep,
    options: StepExecutionOptions = {},
  ): Promise<StreamingStepExecutionOutput> {
    assertNotAborted(options.signal, "EXECUTION_CANCELLED", "Execution was cancelled before this step could start.");

    if (step.toolCategory !== undefined) {
      throw omniCoreDomainError(
        "UNSUPPORTED_CAPABILITY",
        `Step "${step.stepId}" targets a tool, which streaming execution does not support.`,
        { stepId: step.stepId, toolCategory: step.toolCategory },
      );
    }

    this.assertSupportedCapabilities(step);

    const { model } = this.selector.select({ requiredCapabilities: step.capabilities });
    const provider = this.registry.getById(model.providerId);
    const textStream = this.streamGeneration(provider, model.modelId, step.inputRequirements, options);

    return { textStream, providerId: model.providerId, modelId: model.modelId };
  }

  /**
   * Lazily produces the step's output as a stream of text chunks — no
   * provider call is made until this generator is actually iterated
   * (standard JS async-generator semantics: calling this method builds
   * the generator object but runs none of its body yet). Delegates to
   * `provider.generateTextStream` when the selected provider genuinely
   * implements it; otherwise falls back to the existing
   * `provider.generateText`, raced against the same timeout/
   * cancellation logic `execute()`'s model path already uses, and
   * emits its one complete result as a single chunk — the endpoint
   * "must not fail merely because the selected provider only supports
   * non-streaming generation."
   *
   * A signal that aborts while a real stream is in flight surfaces
   * here as `EXECUTION_CANCELLED`, whether the abort itself caused the
   * provider's async iterator to throw (typically an SDK/fetch abort
   * error) or something else did — `options.signal?.aborted` being
   * true at the moment of failure is what decides the error is a
   * cancellation, not the shape of whatever the provider itself threw.
   * Any other provider error propagates unchanged, exactly as
   * `execute()`'s model path already does.
   */
  private async *streamGeneration(
    provider: OmniProvider,
    modelId: ModelId,
    prompt: string,
    options: StepExecutionOptions,
  ): AsyncGenerator<string> {
    if (provider.generateTextStream) {
      try {
        for await (const chunk of provider.generateTextStream(modelId, prompt, { signal: options.signal })) {
          yield chunk;
        }
      } catch (error) {
        if (options.signal?.aborted) {
          throw omniCoreDomainError("EXECUTION_CANCELLED", "Execution was cancelled while streaming.");
        }
        throw error;
      }
      return;
    }

    const output = await raceAgainstTimeoutAndCancellation(
      provider.generateText(modelId, prompt),
      options,
      { timeoutCode: "EXECUTION_TIMEOUT", cancelledCode: "EXECUTION_CANCELLED" },
    );
    yield output;
  }

  private assertSupportedCapabilities(step: TaskPlanStep): void {
    const unsupported = step.capabilities.filter((capability) => !EXECUTABLE_CAPABILITIES.has(capability));
    if (unsupported.length > 0) {
      throw omniCoreDomainError(
        "UNSUPPORTED_CAPABILITY",
        `Step "${step.stepId}" requires a capability this phase cannot execute.`,
        { stepId: step.stepId, unsupported },
      );
    }
  }
}
