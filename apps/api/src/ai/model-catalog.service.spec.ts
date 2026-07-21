import type { ModelMetadata } from "@omniscience/types";
import { ModelCatalogService } from "./model-catalog.service";

function makeModel(overrides: Partial<ModelMetadata> = {}): ModelMetadata {
  return {
    providerId: "fake-provider",
    modelId: "fake-model",
    displayName: "Fake Model",
    capabilities: ["text-generation"],
    availability: "available",
    priority: 10,
    ...overrides,
  };
}

describe("ModelCatalogService", () => {
  let catalog: ModelCatalogService;

  beforeEach(() => {
    catalog = new ModelCatalogService();
  });

  it("registers a model and retrieves it by provider + model id", () => {
    const model = makeModel();
    catalog.register(model);
    expect(catalog.getOne("fake-provider", "fake-model")).toEqual(model);
  });

  it("rejects a duplicate (providerId, modelId) pair", () => {
    catalog.register(makeModel());
    expect(() => catalog.register(makeModel())).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "DUPLICATE_MODEL" }) }),
    );
  });

  it("allows the same modelId across two different providers", () => {
    catalog.register(makeModel({ providerId: "provider-a" }));
    expect(() => catalog.register(makeModel({ providerId: "provider-b" }))).not.toThrow();
  });

  it("throws MODEL_NOT_FOUND for an unregistered pair", () => {
    expect(() => catalog.getOne("fake-provider", "missing-model")).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "MODEL_NOT_FOUND" }) }),
    );
  });

  it("lists models scoped to one provider", () => {
    const a = makeModel({ providerId: "provider-a", modelId: "model-a" });
    const b = makeModel({ providerId: "provider-b", modelId: "model-b" });
    catalog.register(a);
    catalog.register(b);
    expect(catalog.listByProvider("provider-a")).toEqual([a]);
  });

  it("filters models by required capabilities", () => {
    const vision = makeModel({ modelId: "vision-model", capabilities: ["text-generation", "vision"] });
    const textOnly = makeModel({ modelId: "text-model", capabilities: ["text-generation"] });
    catalog.register(vision);
    catalog.register(textOnly);

    expect(catalog.filterByCapabilities(["vision"])).toEqual([vision]);
    expect(catalog.filterByCapabilities(["text-generation"])).toEqual([vision, textOnly]);
  });

  it("exposes unavailable models via list() rather than hiding them", () => {
    const unavailable = makeModel({ modelId: "down-model", availability: "unavailable" });
    catalog.register(unavailable);
    expect(catalog.list()).toEqual([unavailable]);
  });
});
