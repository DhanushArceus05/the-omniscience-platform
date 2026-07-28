import { Injectable } from "@nestjs/common";
import type { ModelCapability, ModelId, ProviderId, TaskPlanStep } from "@omniscience/types";
import { ModelSelectorService } from "../ai/model-selector.service";
import { ProviderRegistryService } from "../ai/provider-registry.service";
import { omniCoreDomainError } from "./omnicore.errors";

/** Every `ModelCapability` this phase has a real execution path for. Kept in sync with `PlanValidatorService`'s `SUPPORTED_TASK_PLAN_CAPABILITIES` (Step 3) — both express the same "what can OmniCore actually run" fact, at two different points in the pipeline. */
const EXECUTABLE_CAPABILITIES: ReadonlySet<ModelCapability> = new Set<ModelCapability>(["text-generation"]);

/** What a `TaskPlanStep` produced when it ran successfully. */
export interface StepExecutionOutput {
  readonly output: string;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}

/** Options controlling how a single step is run. Both are optional — omitting either runs the step with no time budget and no way to cancel it, exactly like Step 1-3's direct `provider.generateText()` call did. */
export interface StepExecutionOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Runs one `TaskPlanStep` to completion (Phase 5 Step 4, requirement
 * 2 "Step Execution"). This is the only place a `TaskPlanStep`'s
 * `capabilities` are turned into an actual model call — reusing
 * `ModelSelectorService`/`ProviderRegistryService` exactly as
 * `OmniCoreService.execute()` used to call them directly before this
 * phase, so behavior for the one capability this phase supports
 * (`"text-generation"`) is unchanged.
 *
 * Every error this method can throw — `UNSUPPORTED_CAPABILITY`,
 * `EXECUTION_TIMEOUT`, `EXECUTION_CANCELLED`, or anything the selector/
 * registry/provider themselves throw (`NO_COMPATIBLE_MODEL`, a mapped
 * provider error, etc.) — propagates unchanged out of `execute()`;
 * this service adds no wrapping of its own, the same invariant
 * `OmniCoreService.execute()` already documented for Step 1-3.
 */
@Injectable()
export class StepExecutorService {
  constructor(
    private readonly selector: ModelSelectorService,
    private readonly registry: ProviderRegistryService,
  ) {}

  async execute(step: TaskPlanStep, options: StepExecutionOptions = {}): Promise<StepExecutionOutput> {
    this.assertSupported(step);
    this.assertNotAborted(options.signal);

    const { model } = this.selector.select({ requiredCapabilities: step.capabilities });
    const provider = this.registry.getById(model.providerId);
    const output = await this.raceAgainstTimeoutAndCancellation(
      provider.generateText(model.modelId, step.inputRequirements),
      options,
    );

    return { output, providerId: model.providerId, modelId: model.modelId };
  }

  private assertSupported(step: TaskPlanStep): void {
    const unsupported = step.capabilities.filter((capability) => !EXECUTABLE_CAPABILITIES.has(capability));
    if (unsupported.length > 0) {
      throw omniCoreDomainError(
        "UNSUPPORTED_CAPABILITY",
        `Step "${step.stepId}" requires a capability this phase cannot execute.`,
        { stepId: step.stepId, unsupported },
      );
    }
  }

  private assertNotAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw omniCoreDomainError("EXECUTION_CANCELLED", "Execution was cancelled before this step could start.");
    }
  }

  /**
   * Races `promise` against an optional timeout and an optional
   * cancellation signal, without touching `promise` itself — if
   * neither is configured, `promise` is returned untouched so this
   * method adds no overhead to the common case. Whichever settles
   * first wins; a timeout throws `EXECUTION_TIMEOUT`, an abort throws
   * `EXECUTION_CANCELLED`, and either listener is always cleaned up so
   * a step that finishes first never leaves a dangling timer or
   * listener behind.
   */
  private raceAgainstTimeoutAndCancellation<T>(promise: Promise<T>, options: StepExecutionOptions): Promise<T> {
    if (options.timeoutMs === undefined && !options.signal) {
      return promise;
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const timer =
        options.timeoutMs !== undefined
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              cleanup();
              reject(
                omniCoreDomainError("EXECUTION_TIMEOUT", `Step execution exceeded its ${options.timeoutMs}ms timeout.`),
              );
            }, options.timeoutMs)
          : undefined;

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(omniCoreDomainError("EXECUTION_CANCELLED", "Execution was cancelled while this step was running."));
      };

      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };

      options.signal?.addEventListener("abort", onAbort);

      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        },
      );
    });
  }
}
