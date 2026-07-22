import { Test, TestingModule } from "@nestjs/testing";
import type { GenerateTextResponse, ModelMetadata, ProviderMetadata } from "@omniscience/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { ModelCatalogService } from "./model-catalog.service";
import { ProviderRegistryService } from "./provider-registry.service";

describe("AiController", () => {
  let controller: AiController;
  const registry = { listMetadata: jest.fn() };
  const catalog = { list: jest.fn(), filterByCapabilities: jest.fn() };
  const aiService = { generate: jest.fn() };

  const providerMetadata: ProviderMetadata = {
    providerId: "gemini",
    displayName: "Google Gemini",
    capabilities: ["text-generation"],
    configStatus: "not-configured",
    priority: 10,
  };

  const modelMetadata: ModelMetadata = {
    providerId: "gemini",
    modelId: "gemini-1.5-flash",
    displayName: "Gemini 1.5 Flash",
    capabilities: ["text-generation", "vision"],
    availability: "available",
    priority: 10,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: ProviderRegistryService, useValue: registry },
        { provide: ModelCatalogService, useValue: catalog },
        { provide: AiService, useValue: aiService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiController>(AiController);
  });

  describe("getProviders()", () => {
    it("wraps the registry's safe metadata in the ApiSuccess envelope", () => {
      registry.listMetadata.mockReturnValue([providerMetadata]);

      expect(controller.getProviders()).toEqual({
        success: true,
        data: { providers: [providerMetadata] },
      });
    });
  });

  describe("getModels()", () => {
    it("returns the unfiltered catalog when no query params are given", () => {
      catalog.list.mockReturnValue([modelMetadata]);

      const result = controller.getModels({});

      expect(catalog.list).toHaveBeenCalled();
      expect(catalog.filterByCapabilities).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: { models: [modelMetadata] } });
    });

    it("filters by capability when provided", () => {
      catalog.filterByCapabilities.mockReturnValue([modelMetadata]);

      const result = controller.getModels({ capability: "vision" });

      expect(catalog.filterByCapabilities).toHaveBeenCalledWith(["vision"]);
      expect(result).toEqual({ success: true, data: { models: [modelMetadata] } });
    });

    it("further filters by provider when both params are provided", () => {
      const otherProviderModel: ModelMetadata = { ...modelMetadata, providerId: "openai" };
      catalog.filterByCapabilities.mockReturnValue([modelMetadata, otherProviderModel]);

      const result = controller.getModels({ capability: "vision", provider: "gemini" });

      expect(result).toEqual({ success: true, data: { models: [modelMetadata] } });
    });

    it("filters by provider alone when no capability is given", () => {
      catalog.list.mockReturnValue([modelMetadata, { ...modelMetadata, providerId: "openai" }]);

      const result = controller.getModels({ provider: "gemini" });

      expect(result).toEqual({ success: true, data: { models: [modelMetadata] } });
    });
  });

  describe("generate()", () => {
    it("delegates to AiService.generate with the validated prompt and wraps the result in ApiSuccess", async () => {
      const response: GenerateTextResponse = {
        text: "Hello, world!",
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
      };
      aiService.generate.mockResolvedValue(response);

      const result = await controller.generate({ prompt: "Say hello" });

      expect(aiService.generate).toHaveBeenCalledWith("Say hello");
      expect(result).toEqual({ success: true, data: response });
    });

    it("returns only text, providerId, and modelId — never matchedRule or other internal metadata", async () => {
      const response: GenerateTextResponse = {
        text: "Hello, world!",
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
      };
      aiService.generate.mockResolvedValue(response);

      const result = await controller.generate({ prompt: "Say hello" });

      expect(Object.keys(result.data)).toEqual(["text", "providerId", "modelId"]);
    });

    it("propagates an AiService error unchanged", async () => {
      const error = { response: { code: "NO_COMPATIBLE_MODEL" } };
      aiService.generate.mockRejectedValue(error);

      await expect(controller.generate({ prompt: "Say hello" })).rejects.toBe(error);
    });
  });
});
