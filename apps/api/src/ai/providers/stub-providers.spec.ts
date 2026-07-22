import type { Env } from "@omniscience/config";
import { GeminiProvider } from "./gemini.provider";
import { OpenAiProvider } from "./openai.provider";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { ...overrides } as unknown as Env;
}

// `AnthropicProvider` is no longer a pure metadata-only stub as of
// Phase 4 Step 2 — its `generateText` makes a real (injected-client)
// call and its constructor now also requires an `ANTHROPIC_CLIENT`,
// so it no longer fits this shared "throws NOT_IMPLEMENTED from every
// execution method" contract or this suite's single-argument
// `new Provider(env)` construction. See `anthropic.provider.spec.ts`
// for its own, dedicated coverage — including the same
// not-configured/not-ready and never-leaks-a-credential guarantees
// this suite still checks for Gemini/OpenAI below.
describe.each([
  { Provider: GeminiProvider, envKey: "GEMINI_API_KEY", providerId: "gemini" },
  { Provider: OpenAiProvider, envKey: "OPENAI_API_KEY", providerId: "openai" },
] as const)("$providerId stub provider descriptor", ({ Provider, envKey, providerId }) => {
  it("reports not-configured / not-ready when its API key env var is unset", () => {
    const provider = new Provider(makeEnv());
    expect(provider.configStatus()).toBe("not-configured");
    expect(provider.isReady()).toBe(false);
  });

  it("reports configured / ready when its API key env var is set", () => {
    const provider = new Provider(makeEnv({ [envKey]: "test-key-value" } as Partial<Env>));
    expect(provider.configStatus()).toBe("configured");
    expect(provider.isReady()).toBe(true);
  });

  it("exposes at least one model, all tagged with its own providerId", () => {
    const provider = new Provider(makeEnv());
    const models = provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.providerId).toBe(providerId);
    }
  });

  it("throws NOT_IMPLEMENTED from every execution method rather than calling a vendor API", async () => {
    const provider = new Provider(makeEnv());
    const [model] = provider.listModels();
    if (!model) {
      throw new Error("expected at least one model");
    }

    await expect(provider.generateText(model.modelId, "hello")).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "NOT_IMPLEMENTED" }) }),
    );
    await expect(provider.generateStructured(model.modelId, "hello", "schema")).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "NOT_IMPLEMENTED" }) }),
    );
    await expect(provider.embed(model.modelId, "hello")).rejects.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ code: "NOT_IMPLEMENTED" }) }),
    );
  });

  it("never returns its own API key value from any public method", () => {
    const secretValue = "super-secret-key-value";
    const provider = new Provider(makeEnv({ [envKey]: secretValue } as Partial<Env>));

    const surface = JSON.stringify({
      configStatus: provider.configStatus(),
      isReady: provider.isReady(),
      models: provider.listModels(),
      providerId: provider.providerId,
      displayName: provider.displayName,
      capabilities: provider.capabilities,
      priority: provider.priority,
    });

    expect(surface).not.toContain(secretValue);
  });

  it("never reports a real execution path, even when its API key is configured (Phase 4 Step 3 execution-eligibility guard)", () => {
    const provider = new Provider(makeEnv({ [envKey]: "test-key-value" } as Partial<Env>));
    expect(provider.isReady()).toBe(true);
    for (const capability of provider.capabilities) {
      expect(provider.supportsExecution(capability)).toBe(false);
    }
  });
});
