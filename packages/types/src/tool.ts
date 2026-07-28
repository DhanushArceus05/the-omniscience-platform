/**
 * OmniCore tool calling framework (Phase 5 Step 5).
 *
 * Mirrors the split `ai-provider.ts`/`ai-provider.interface.ts` already
 * established for models: the data-only *description* of a tool
 * (`ToolMetadata`, here) lives in this shared types package, same as
 * `ModelMetadata`; the executable *contract* (`Tool`, with its
 * `execute()` method) lives in `apps/api/src/omnicore/tools/tool.interface.ts`,
 * same as `OmniProvider` — an interface with real runtime behavior
 * belongs next to the NestJS code that implements and consumes it, not
 * in a types-only package also shared with the Vite web app.
 *
 * `ToolCapability` is deliberately a plain `string`, not a closed union
 * like `ModelCapability`: a model's capabilities are a small, curated
 * set this platform's own routing logic must exhaustively understand
 * (`ModelSelectorService`, `PlanValidatorService`'s supported-capability
 * check), so a new one is a real, deliberate core-type change. A
 * tool's capabilities are just descriptive metadata about what a tool
 * does, with no routing logic keyed off them yet — the same
 * intentionally-open design `TaskPlanStep.toolCategory` (`omnicore-plan.ts`,
 * Phase 5 Step 3) already uses for "which tool" a step needs. Adding a
 * new built-in tool never requires touching this file.
 */

import type { ExecutionStatus } from "./omnicore-execution";

export type ToolCapability = string;

/** Descriptive metadata for one registered `Tool` — the data a `ToolRegistryService.list()` caller reads without needing the tool's own executable implementation. */
export interface ToolMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly ToolCapability[];
}

/**
 * The outcome of running one tool through `ToolExecutorService`.
 * Deliberately its own type rather than reusing `StepExecutionResult`
 * verbatim: a tool call is not itself a `TaskPlanStep` — `output` here
 * is `unknown` (a tool's own `outputSchema`-validated result, of
 * whatever shape that tool declares), where a `StepExecutionResult`'s
 * `output` is always the `string` a `TaskPlanStep` produces. When a
 * step is tool-routed, `StepExecutorService` is the seam that adapts
 * one into the other — see that service's doc comment.
 */
export interface ToolExecutionResult {
  readonly toolId: string;
  readonly status: ExecutionStatus;
  readonly output?: unknown;
  readonly errorCode?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
}
