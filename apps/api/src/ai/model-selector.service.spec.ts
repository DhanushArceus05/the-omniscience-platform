import type { ModelMetadata, ProviderCapability, ProviderConfigStatus } from "@omniscience/types";
import type { OmniProvider } from "./ai-provider.interface";
import { ModelCatalogService } from "./model-catalog.service";
import { ModelSelectorService } from "./model-selector.service";
import { ProviderRegistryService } from "./provider-registry.service";

function makeProvider(providerId: string, ready = true): OmniProvider {
  return {
    providerId,
    displayName: providerId,
    capabilities: ["text-generation"] as readonly ProviderCapability[],
    priority: 10,
    configStatus: (): ProviderConfigStatus => (ready ? "configured" : "not-configured"),
    isReady: (): boolean => ready,
    listModels: (): readonly ModelMetadata[] => [],
    generateText: (): Promise<string> => Promise.reject(new Error("not implemented")),
    generateStructured: (): Promise<unknown> => Promise.reject(new Error("not implemented")),
    embed: (): Promise<readonly number[]> => Promise.reject(new Error("not implemented")),
  };
}

function makeModel(overrides: Partial<ModelMetadata> = {}): ModelMetadata {
  return {
    providerId: "provider-a",
    modelId: "model-a",
    displayName: "Model A",
    capabilities: ["text-generation"],
    availability: "available",
    priority: 10,
    ...overrides,
  };
}

describe("ModelSelectorService", () => {
  let registry: ProviderRegistryService;
  let catalog: ModelCatalogService;
  let selector: ModelSelectorService;

  beforeEach(() => {
    registry = new ProviderRegistryService();
    catalog = new ModelCatalogService();
    selector = new ModelSelectorService(catalog, registry);
  });

  it("honors an available, compatible preferred model", () => {
    registry.register(makeProvider("provider-a"));
    registry.register(makeProvider("provider-b"));
    const preferred = makeModel({ providerId: "provider-a", modelId: "preferred", priority: 50 });
    const other = makeModel({ providerId: "provider-b", modelId: "other", priority: 1 });
    catalog.register(preferred);
    catalog.register(other);

    const result = selector.select({
      requiredCapabilities: ["text-generation"],
      preferredModelId: "preferred",
    });

    expect(result.matchedRule).toBe("preferred-model");
    expect(result.model).toEqual(preferred);
  });

  it("falls back to preferred provider when the preferred model isn't found", () => {
    registry.register(makeProvider("provider-a"));
    registry.register(makeProvider("provider-b"));
    const inProvider = makeModel({ providerId: "provider-a", modelId: "model-a", priority: 50 });
    const elsewhere = makeModel({ providerId: "provider-b", modelId: "model-b", priority: 1 });
    catalog.register(inProvider);
    catalog.register(elsewhere);

    const result = selector.select({
      requiredCapabilities: ["text-generation"],
      preferredModelId: "does-not-exist",
      preferredProviderId: "provider-a",
    });

    expect(result.matchedRule).toBe("preferred-provider");
    expect(result.model).toEqual(inProvider);
  });

  it("falls back to the highest-priority compatible available model by default", () => {
    registry.register(makeProvider("provider-a"));
    registry.register(makeProvider("provider-b"));
    const higherPriority = makeModel({ providerId: "provider-a", modelId: "model-a", priority: 5 });
    const lowerPriority = makeModel({ providerId: "provider-b", modelId: "model-b", priority: 50 });
    catalog.register(lowerPriority);
    catalog.register(higherPriority);

    const result = selector.select({ requiredCapabilities: ["text-generation"] });

    expect(result.matchedRule).toBe("priority-fallback");
    expect(result.model).toEqual(higherPriority);
  });

  it("excludes models whose provider is not ready, even if marked available", () => {
    registry.register(makeProvider("provider-a", false));
    registry.register(makeProvider("provider-b", true));
    const notReady = makeModel({ providerId: "provider-a", modelId: "model-a", priority: 1 });
    const ready = makeModel({ providerId: "provider-b", modelId: "model-b", priority: 50 });
    catalog.register(notReady);
    catalog.register(ready);

    const result = selector.select({ requiredCapabilities: ["text-generation"] });

    expect(result.model).toEqual(ready);
  });

  it("excludes models missing a required capability", () => {
    registry.register(makeProvider("provider-a"));
    catalog.register(
      makeModel({ providerId: "provider-a", modelId: "model-a", capabilities: ["embeddings"] }),
    );

    expect(() => selector.select({ requiredCapabilities: ["text-generation"] })).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "NO_COMPATIBLE_MODEL" }) }),
    );
  });

  it("throws NO_COMPATIBLE_MODEL when the catalog is empty", () => {
    expect(() => selector.select({ requiredCapabilities: ["text-generation"] })).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "NO_COMPATIBLE_MODEL" }) }),
    );
  });
});
