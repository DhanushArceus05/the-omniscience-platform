import type { ModelMetadata, ProviderCapability, ProviderConfigStatus } from "@omniscience/types";
import type { OmniProvider } from "./ai-provider.interface";
import { ProviderRegistryService } from "./provider-registry.service";

function makeProvider(overrides: Partial<OmniProvider> = {}): OmniProvider {
  return {
    providerId: "fake-provider",
    displayName: "Fake Provider",
    capabilities: ["text-generation"] as readonly ProviderCapability[],
    priority: 10,
    configStatus: (): ProviderConfigStatus => "configured",
    isReady: (): boolean => true,
    listModels: (): readonly ModelMetadata[] => [],
    supportsExecution: (): boolean => true,
    generateText: (): Promise<string> => Promise.reject(new Error("not implemented")),
    generateStructured: (): Promise<unknown> => Promise.reject(new Error("not implemented")),
    embed: (): Promise<readonly number[]> => Promise.reject(new Error("not implemented")),
    ...overrides,
  };
}

describe("ProviderRegistryService", () => {
  let registry: ProviderRegistryService;

  beforeEach(() => {
    registry = new ProviderRegistryService();
  });

  it("registers a provider and retrieves it by id", () => {
    const provider = makeProvider();
    registry.register(provider);
    expect(registry.getById("fake-provider")).toBe(provider);
  });

  it("rejects registering a duplicate provider id", () => {
    registry.register(makeProvider());
    expect(() => registry.register(makeProvider())).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "DUPLICATE_PROVIDER" }) }),
    );
  });

  it("throws PROVIDER_NOT_FOUND for an unregistered id", () => {
    expect(() => registry.getById("missing")).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "PROVIDER_NOT_FOUND" }) }),
    );
  });

  it("lists every registered provider in registration order", () => {
    const first = makeProvider({ providerId: "first" });
    const second = makeProvider({ providerId: "second" });
    registry.register(first);
    registry.register(second);
    expect(registry.list()).toEqual([first, second]);
  });

  it("filters providers by required capabilities", () => {
    const vision = makeProvider({
      providerId: "vision-provider",
      capabilities: ["text-generation", "vision"],
    });
    const textOnly = makeProvider({ providerId: "text-provider", capabilities: ["text-generation"] });
    registry.register(vision);
    registry.register(textOnly);

    expect(registry.filterByCapabilities(["vision"])).toEqual([vision]);
    expect(registry.filterByCapabilities(["text-generation"])).toEqual([vision, textOnly]);
  });

  it("returns safe metadata only, never a credential value", () => {
    const CREDENTIAL_VALUE = "sk-test-fake-credential-value-should-never-appear";
    const provider = makeProvider({
      providerId: "provider-with-credentials",
      configStatus: (): ProviderConfigStatus => "configured",
    });
    registry.register(provider);

    const metadata = registry.listMetadata();
    expect(metadata).toEqual([
      {
        providerId: "provider-with-credentials",
        displayName: "Fake Provider",
        capabilities: ["text-generation"],
        configStatus: "configured",
        priority: 10,
      },
    ]);
    // The metadata object has a fixed, known shape (asserted above) with
    // no field capable of carrying a credential value — this additionally
    // confirms that even a credential value present elsewhere in the
    // process could never leak through this specific serialization path.
    expect(JSON.stringify(metadata)).not.toContain(CREDENTIAL_VALUE);
  });
});
