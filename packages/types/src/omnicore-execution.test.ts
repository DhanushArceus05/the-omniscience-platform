import { describe, expect, it } from "vitest";
import type { ExecutionStatus, PlanExecutionResult, StageExecutionResult, StepExecutionResult } from "./omnicore-execution";

describe("omnicore-execution type shapes", () => {
  function stepResultFixture(overrides: Partial<StepExecutionResult> = {}): StepExecutionResult {
    return {
      stepId: "step-1",
      status: "completed",
      output: "Hello!",
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      startedAt: "2026-07-27T00:00:00.000Z",
      completedAt: "2026-07-27T00:00:01.000Z",
      durationMs: 1000,
      ...overrides,
    };
  }

  it("builds a valid completed PlanExecutionResult for a single-step, single-stage plan", () => {
    const stepResult = stepResultFixture();
    const stageResult: StageExecutionResult = {
      stageId: "stage-1",
      status: "completed",
      stepResults: [stepResult],
      startedAt: stepResult.startedAt,
      completedAt: stepResult.completedAt,
      durationMs: stepResult.durationMs,
    };
    const planResult: PlanExecutionResult = {
      taskPlanId: "task-plan-1",
      status: "completed",
      stageResults: [stageResult],
      startedAt: stepResult.startedAt,
      completedAt: stepResult.completedAt,
      durationMs: stepResult.durationMs,
    };

    expect(planResult.status).toBe("completed");
    expect(planResult.stageResults[0]?.stepResults[0]?.output).toBe("Hello!");
  });

  it("builds a failed step result carrying an errorCode instead of output", () => {
    const stepResult = stepResultFixture({
      status: "failed",
      output: undefined,
      errorCode: "PROVIDER_RATE_LIMITED",
    });

    expect(stepResult.status).toBe("failed");
    expect(stepResult.errorCode).toBe("PROVIDER_RATE_LIMITED");
    expect(stepResult.output).toBeUndefined();
  });

  it("covers every ExecutionStatus value", () => {
    const statuses: readonly ExecutionStatus[] = ["pending", "running", "completed", "failed", "skipped", "cancelled"];
    for (const status of statuses) {
      const stepResult = stepResultFixture({ status, output: undefined, completedAt: undefined, durationMs: undefined });
      expect(stepResult.status).toBe(status);
    }
  });
});
