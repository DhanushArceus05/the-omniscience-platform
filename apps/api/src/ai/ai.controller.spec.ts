import { Test, TestingModule } from "@nestjs/testing";
import type { ModelMetadata, ProviderMetadata } from "@omniscience/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AiController } from "./ai.controller";
import { ModelCatalogService } from "./model-catalog.service";
import { ProviderRegistryService } from "./provider-registry.service";

describe("AiController", () => {
  let controller: AiController;
  const registry = { listMetadata: jest.fn() };
  const catalog = { list: jest.fn(), filterByCapabilities: jest.fn() };

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
});
