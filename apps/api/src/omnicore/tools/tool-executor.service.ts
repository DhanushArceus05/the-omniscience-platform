import { HttpException, Injectable } from "@nestjs/common";
import type { ToolExecutionResult } from "@omniscience/types";
import { assertNotAborted, raceAgainstTimeoutAndCancellation, type RaceOptions } from "../execution-timeout.util";
import { omniCoreDomainError } from "../omnicore.errors";
import { ToolRegistryService } from "./tool-registry.service";

/** Options controlling a single tool call. Both are optional — see `execution-timeout.util.ts`. */
export type ToolExecutionOptions = RaceOptions;

/**
 * Runs one registered `Tool` to completion (Phase 5 Step 5,
 * requirement 3 "Tool Executor"). The pipeline is always: look the
 * tool up by id (`ToolRegistryService.getById()`, `TOOL_NOT_FOUND` if
 * missing) → validate `rawInput` against the tool's own `inputSchema`
 * (`INVALID_TOOL_INPUT` if it fails) → run `tool.execute()`, raced
 * against an optional timeout/cancellation exactly like
 * `StepExecutorService` races a provider call (`execution-timeout.util.ts`,
 * requirement 3: "reuse Step 4 execution architecture") → validate the
 * result against the tool's own `outputSchema` (`TOOL_EXECUTION_FAILED`
 * if that fails) → return a `ToolExecutionResult`.
 *
 * Never executes an unknown tool (requirement 7): a missing id fails
 * at the registry lookup, before `rawInput` is even looked at. Never
 * lets a tool's own thrown value escape unnormalized either: anything
 * `tool.execute()` throws that isn't already one of this module's own
 * typed `HttpException`s (e.g. a plain bug in a tool's implementation)
 * is wrapped into `TOOL_EXECUTION_FAILED` — an `HttpException` a tool
 * itself throws (there are none in this phase's three built-in tools,
 * but a future tool may legitimately want to signal its own typed
 * failure) propagates unchanged instead, the same "already-typed
 * errors are never double-wrapped" rule `ExecutionOrchestratorService`
 * already follows for step failures.
 */
@Injectable()
export class ToolExecutorService {
  constructor(private readonly registry: ToolRegistryService) {}

  async execute(toolId: string, rawInput: unknown, options: ToolExecutionOptions = {}): Promise<ToolExecutionResult> {
    const tool = this.registry.getById(toolId);

    const parsedInput = tool.inputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      throw omniCoreDomainError("INVALID_TOOL_INPUT", `Tool "${toolId}" rejected its input.`, {
        toolId,
        issues: parsedInput.error.issues,
      });
    }

    assertNotAborted(options.signal, "TOOL_CANCELLED", `Tool "${toolId}" execution was cancelled before it could start.`);

    const startedAt = new Date();
    let rawOutput: unknown;
    try {
      rawOutput = await raceAgainstTimeoutAndCancellation(tool.execute(parsedInput.data), options, {
        timeoutCode: "TOOL_TIMEOUT",
        cancelledCode: "TOOL_CANCELLED",
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw omniCoreDomainError("TOOL_EXECUTION_FAILED", `Tool "${toolId}" failed during execution.`, {
        toolId,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const parsedOutput = tool.outputSchema.safeParse(rawOutput);
    if (!parsedOutput.success) {
      throw omniCoreDomainError(
        "TOOL_EXECUTION_FAILED",
        `Tool "${toolId}" produced output that failed its own output schema.`,
        { toolId, issues: parsedOutput.error.issues },
      );
    }

    const completedAt = new Date();
    return {
      toolId,
      status: "completed",
      output: parsedOutput.data,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }
}
