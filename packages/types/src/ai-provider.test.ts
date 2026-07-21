import { describe, expect, it } from "vitest";
import type {
  ModelMetadata,
  ModelSelectionRequest,
  ModelSelectionResult,
  ProviderMetadata,
} from "./ai-provider";

describe("ai-provider type shapes", () => {
  it("builds a valid ModelMetadata value", () => {
    const model: ModelMetadata = {
      providerId: "gemini",
      modelId: "gemini-1.5-flash",
      displayName: "Gemini 1.5 Flash",
      capabilities: ["text-generation", "streaming"],
      availability: "available",
      priority: 10,
    };
    expect(model.providerId).toBe("gemini");
  });

  it("builds a valid ProviderMetadata value", () => {
    const provider: ProviderMetadata = {
      providerId: "openai",
      displayName: "OpenAI",
      capabilities: ["text-generation", "embeddings"],
      configStatus: "not-configured",
      priority: 20,
    };
    expect(provider.configStatus).toBe("not-configured");
  });

  it("builds a valid ModelSelectionRequest/Result pair", () => {
    const request: ModelSelectionRequest = {
      requiredCapabilities: ["text-generation"],
      preferredModelId: "gemini-1.5-flash",
    };
    const model: ModelMetadata = {
      providerId: "gemini",
      modelId: "gemini-1.5-flash",
      displayName: "Gemini 1.5 Flash",
      capabilities: ["text-generation"],
      availability: "available",
      priority: 10,
    };
    const result: ModelSelectionResult = { model, matchedRule: "preferred-model" };

    expect(request.preferredModelId).toBe(result.model.modelId);
  });
});
