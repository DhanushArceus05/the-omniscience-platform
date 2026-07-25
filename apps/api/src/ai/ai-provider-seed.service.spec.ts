import type { Logger } from "pino";
import { AiProviderSeedService } from "./ai-provider-seed.service";
import { ModelCatalogService } from "./model-catalog.service";
import { ProviderRegistryService } from "./provider-registry.service";
import type { AnthropicProvider } from "./providers/anthropic.provider";
import type { GeminiProvider } from "./providers/gemini.provider";
import type { OpenAiProvider } from "./providers/openai.provider";

function makeFakeProvider(providerId: string, configStatus: "configured" | "not-configured") {
  return {
    providerId,
    displayName: providerId,
    capabilities: ["text-generation"],
    priority: 10,
    configStatus: () => configStatus,
    isReady: () => configStatus === "configured",
    supportsExecution: (capability: string) =>
      configStatus === "configured" && capability === "text-generation",
    listModels: () => [
      {
        providerId,
        modelId: `${providerId}-model`,
        displayName: `${providerId} model`,
        capabilities: ["text-generation"],
        availability: "available",
        priority: 10,
      },
    ],
  };
}

function makeLogger(): Logger {
  return { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } as unknown as Logger;
}

describe("AiProviderSeedService", () => {
  it("registers every provider and its models into the registry/catalog exactly once", () => {
    const registry = new ProviderRegistryService();
    const catalog = new ModelCatalogService();
    const gemini = makeFakeProvider("gemini", "configured");
    const openai = makeFakeProvider("openai", "not-configured");
    const anthropic = makeFakeProvider("anthropic", "not-configured");
    const logger = makeLogger();

    const service = new AiProviderSeedService(
      registry,
      catalog,
      gemini as unknown as GeminiProvider,
      openai as unknown as OpenAiProvider,
      anthropic as unknown as AnthropicProvider,
      logger,
    );

    service.onModuleInit();

    expect(registry.list().map((p) => p.providerId).sort()).toEqual(["anthropic", "gemini", "openai"]);
    expect(catalog.list()).toHaveLength(3);
  });

  it("logs an info-level registry-seeded summary with every provider's configStatus, never a credential value", () => {
    const registry = new ProviderRegistryService();
    const catalog = new ModelCatalogService();
    const gemini = makeFakeProvider("gemini", "configured");
    const openai = makeFakeProvider("openai", "not-configured");
    const anthropic = makeFakeProvider("anthropic", "not-configured");
    const logger = makeLogger();

    new AiProviderSeedService(
      registry,
      catalog,
      gemini as unknown as GeminiProvider,
      openai as unknown as OpenAiProvider,
      anthropic as unknown as AnthropicProvider,
      logger,
    ).onModuleInit();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.arrayContaining([
          { providerId: "gemini", configStatus: "configured" },
          { providerId: "openai", configStatus: "not-configured" },
          { providerId: "anthropic", configStatus: "not-configured" },
        ]),
        modelCount: 3,
      }),
      expect.stringContaining("seeded"),
    );
  });

  it("warns when no registered provider is both ready and execution-capable", () => {
    const registry = new ProviderRegistryService();
    const catalog = new ModelCatalogService();
    const gemini = makeFakeProvider("gemini", "not-configured");
    const openai = makeFakeProvider("openai", "not-configured");
    const anthropic = makeFakeProvider("anthropic", "not-configured");
    const logger = makeLogger();

    new AiProviderSeedService(
      registry,
      catalog,
      gemini as unknown as GeminiProvider,
      openai as unknown as OpenAiProvider,
      anthropic as unknown as AnthropicProvider,
      logger,
    ).onModuleInit();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ providers: expect.any(Array) }),
      expect.stringContaining("NO_COMPATIBLE_MODEL"),
    );
  });

  it("does not warn when at least one registered provider is ready and execution-capable", () => {
    const registry = new ProviderRegistryService();
    const catalog = new ModelCatalogService();
    const gemini = makeFakeProvider("gemini", "configured");
    const openai = makeFakeProvider("openai", "not-configured");
    const anthropic = makeFakeProvider("anthropic", "not-configured");
    const logger = makeLogger();

    new AiProviderSeedService(
      registry,
      catalog,
      gemini as unknown as GeminiProvider,
      openai as unknown as OpenAiProvider,
      anthropic as unknown as AnthropicProvider,
      logger,
    ).onModuleInit();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("still warns when a provider is ready (configured) but not genuinely execution-capable (a metadata-only stub)", () => {
    // Mirrors OpenAI's real shape today: `isReady()` can be true purely
    // from a configured API key, while `supportsExecution` is still
    // false for every capability because it's still a Step 1 stub.
    const registry = new ProviderRegistryService();
    const catalog = new ModelCatalogService();
    const readyButStubProvider = {
      ...makeFakeProvider("openai", "configured"),
      supportsExecution: () => false,
    };
    const gemini = makeFakeProvider("gemini", "not-configured");
    const anthropic = makeFakeProvider("anthropic", "not-configured");
    const logger = makeLogger();

    new AiProviderSeedService(
      registry,
      catalog,
      gemini as unknown as GeminiProvider,
      readyButStubProvider as unknown as OpenAiProvider,
      anthropic as unknown as AnthropicProvider,
      logger,
    ).onModuleInit();

    expect(logger.warn).toHaveBeenCalled();
  });
});
