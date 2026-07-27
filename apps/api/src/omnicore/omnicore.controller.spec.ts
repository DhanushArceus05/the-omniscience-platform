import { Test, TestingModule } from "@nestjs/testing";
import type { OmniCoreExecuteResponse, TaskPlan } from "@omniscience/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OmniCoreController } from "./omnicore.controller";
import { OmniCoreService } from "./omnicore.service";

const taskPlan: TaskPlan = {
  taskPlanId: "task-plan-1",
  sourceCapabilityPlanId: "plan-1",
  intent: "simple-generation",
  steps: [
    {
      stepId: "step-1",
      title: "Generate a response",
      description: "Generate a response for the given prompt using the text-generation capability.",
      objective: "Produce a direct response to the user's prompt.",
      capabilities: ["text-generation"],
      inputRequirements: "Say hello",
      expectedOutput: "Generated text responding to the prompt.",
      dependsOn: [],
      executionMode: "sequential",
      complexity: "low",
      failurePolicy: { mode: "abort" },
    },
  ],
  stages: [{ stageId: "stage-1", mode: "sequential", stepIds: ["step-1"] }],
  complexity: "low",
};

describe("OmniCoreController", () => {
  let controller: OmniCoreController;
  const omniCore = { execute: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OmniCoreController],
      providers: [{ provide: OmniCoreService, useValue: omniCore }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OmniCoreController>(OmniCoreController);
  });

  describe("execute()", () => {
    it("delegates to OmniCoreService.execute with the validated prompt and wraps the result in ApiSuccess", async () => {
      const response: OmniCoreExecuteResponse = {
        planId: "plan-1",
        intent: "simple-generation",
        matchedRuleId: "fast-rule.default-text-generation",
        confidence: 0.75,
        text: "Hello, world!",
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
        taskPlan,
      };
      omniCore.execute.mockResolvedValue(response);

      const result = await controller.execute({ prompt: "Say hello" });

      expect(omniCore.execute).toHaveBeenCalledWith("Say hello");
      expect(result).toEqual({ success: true, data: response });
    });

    it("returns only the fields OmniCoreService produces — no extra wrapping metadata", async () => {
      const response: OmniCoreExecuteResponse = {
        planId: "plan-1",
        intent: "simple-generation",
        matchedRuleId: "fast-rule.default-text-generation",
        confidence: 0.75,
        text: "Hello, world!",
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
        taskPlan,
      };
      omniCore.execute.mockResolvedValue(response);

      const result = await controller.execute({ prompt: "Say hello" });

      expect(Object.keys(result.data)).toEqual([
        "planId",
        "intent",
        "matchedRuleId",
        "confidence",
        "text",
        "providerId",
        "modelId",
        "taskPlan",
      ]);
    });

    it("propagates an OmniCoreService error unchanged", async () => {
      const error = { response: { code: "NO_COMPATIBLE_MODEL" } };
      omniCore.execute.mockRejectedValue(error);

      await expect(controller.execute({ prompt: "Say hello" })).rejects.toBe(error);
    });

    it("propagates an AMBIGUOUS_INTENT error unchanged, including its alternateIntents detail", async () => {
      const error = {
        response: { code: "AMBIGUOUS_INTENT", alternateIntents: ["code-generation", "summarization"] },
      };
      omniCore.execute.mockRejectedValue(error);

      await expect(controller.execute({ prompt: "Summarize this code snippet" })).rejects.toBe(error);
    });
  });
});
