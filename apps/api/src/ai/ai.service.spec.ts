import type { Logger } from "pino";
import type { ModelMetadata, ModelSelectionResult } from "@omniscience/types";
import { AiService } from "./ai.service";
import { ModelSelectorService } from "./model-selector.service";
import { ProviderRegistryService } from "./provider-registry.service";

describe("AiService", () => {
  const selector = { select: jest.fn() };
  const registry = { getById: jest.fn() };
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  let service: AiService;

  const model: ModelMetadata = {
    providerId: "anthropic",
    modelId: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    capabilities: ["text-generation"],
    availability: "available",
    priority: 15,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiService(
      selector as unknown as ModelSelectorService,
      registry as unknown as ProviderRegistryService,
      logger as unknown as Logger,
    );
  });

  it("requests only text-generation from the selector — never a caller-supplied capability", async () => {
    const selection: ModelSelectionResult = { model, matchedRule: "priority-fallback" };
    selector.select.mockReturnValue(selection);
    const generateText = jest.fn().mockResolvedValue("Hello!");
    registry.getById.mockReturnValue({ generateText });

    await service.generate("hi there");

    expect(selector.select).toHaveBeenCalledWith({ requiredCapabilities: ["text-generation"] });
  });

  it("looks up the selected model's provider and calls generateText with the selected model id and the given prompt", async () => {
    const selection: ModelSelectionResult = { model, matchedRule: "priority-fallback" };
    selector.select.mockReturnValue(selection);
    const generateText = jest.fn().mockResolvedValue("Hello!");
    registry.getById.mockReturnValue({ generateText });

    await service.generate("hi there");

    expect(registry.getById).toHaveBeenCalledWith("anthropic");
    expect(generateText).toHaveBeenCalledWith("claude-sonnet-5", "hi there");
  });

  it("returns only text, providerId, and modelId — never matchedRule or other internal routing metadata", async () => {
    const selection: ModelSelectionResult = { model, matchedRule: "priority-fallback" };
    selector.select.mockReturnValue(selection);
    registry.getById.mockReturnValue({ generateText: jest.fn().mockResolvedValue("Hello!") });

    const result = await service.generate("hi there");

    expect(result).toEqual({
      text: "Hello!",
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
    });
  });

  it("propagates a NO_COMPATIBLE_MODEL error from the selector unchanged", async () => {
    const error = { response: { code: "NO_COMPATIBLE_MODEL" } };
    selector.select.mockImplementation(() => {
      throw error;
    });

    await expect(service.generate("hi there")).rejects.toBe(error);
    expect(registry.getById).not.toHaveBeenCalled();
  });

  it("propagates a provider execution error unchanged, without wrapping it", async () => {
    const selection: ModelSelectionResult = { model, matchedRule: "priority-fallback" };
    selector.select.mockReturnValue(selection);
    const providerError = { response: { code: "PROVIDER_RATE_LIMITED" } };
    registry.getById.mockReturnValue({
      generateText: jest.fn().mockRejectedValue(providerError),
    });

    await expect(service.generate("hi there")).rejects.toBe(providerError);
  });

  // Phase 4 Step 5: success-path logging, added for production
  // observability. Deliberately no equivalent test for the error path —
  // see the class doc comment for why (AllExceptionsFilter already
  // logs every thrown error centrally; this method must not double-log).
  describe("success-path logging (Phase 4 Step 5)", () => {
    it("logs the selected provider, model, and matched rule at debug on success", async () => {
      const selection: ModelSelectionResult = { model, matchedRule: "preferred-model" };
      selector.select.mockReturnValue(selection);
      registry.getById.mockReturnValue({ generateText: jest.fn().mockResolvedValue("Hello!") });

      await service.generate("hi there");

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "anthropic",
          modelId: "claude-sonnet-5",
          matchedRule: "preferred-model",
        }),
        expect.any(String),
      );
    });

    it("never logs anything when the selector throws (no compatible model)", async () => {
      selector.select.mockImplementation(() => {
        throw { response: { code: "NO_COMPATIBLE_MODEL" } };
      });

      await expect(service.generate("hi there")).rejects.toBeDefined();

      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("never logs anything when the provider's generateText rejects", async () => {
      const selection: ModelSelectionResult = { model, matchedRule: "priority-fallback" };
      selector.select.mockReturnValue(selection);
      registry.getById.mockReturnValue({
        generateText: jest.fn().mockRejectedValue({ response: { code: "PROVIDER_TIMEOUT" } }),
      });

      await expect(service.generate("hi there")).rejects.toBeDefined();

      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
