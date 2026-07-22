import type { ModelMetadata, ModelSelectionResult } from "@omniscience/types";
import { AiService } from "./ai.service";
import { ModelSelectorService } from "./model-selector.service";
import { ProviderRegistryService } from "./provider-registry.service";

describe("AiService", () => {
  const selector = { select: jest.fn() };
  const registry = { getById: jest.fn() };
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
});
