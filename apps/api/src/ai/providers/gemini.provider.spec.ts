import { ApiError } from "@google/genai";
import type { Env } from "@omniscience/config";
import type { GeminiModelsClient } from "./gemini-client.provider";
import { GeminiProvider } from "./gemini.provider";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { ...overrides } as unknown as Env;
}

interface FakeGeminiClient extends GeminiModelsClient {
  readonly models: { readonly generateContent: jest.Mock };
}

function makeClient(): FakeGeminiClient {
  return { models: { generateContent: jest.fn() } };
}

describe("GeminiProvider", () => {
  describe("metadata (unchanged Step 1 conventions)", () => {
    it("advertises only text-generation — no unimplemented capability is claimed", () => {
      const provider = new GeminiProvider(makeEnv(), makeClient());
      expect(provider.capabilities).toEqual(["text-generation"]);
      for (const model of provider.listModels()) {
        expect(model.capabilities).toEqual(["text-generation"]);
        expect(model.providerId).toBe("gemini");
      }
    });

    it("reports not-configured / not-ready when GEMINI_API_KEY is unset", () => {
      const provider = new GeminiProvider(makeEnv(), makeClient());
      expect(provider.configStatus()).toBe("not-configured");
      expect(provider.isReady()).toBe(false);
    });

    it("reports configured / ready when GEMINI_API_KEY is set", () => {
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), makeClient());
      expect(provider.configStatus()).toBe("configured");
      expect(provider.isReady()).toBe(true);
    });

    it("never returns its own API key value from any public method", () => {
      const secretValue = "super-secret-gemini-key-value";
      const provider = new GeminiProvider(
        makeEnv({ GEMINI_API_KEY: secretValue }),
        makeClient(),
      );
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

    it("reports a real execution path only for text-generation (Phase 4 Step 3 execution-eligibility, unchanged)", () => {
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), makeClient());
      expect(provider.supportsExecution("text-generation")).toBe(true);
      expect(provider.supportsExecution("embeddings")).toBe(false);
      expect(provider.supportsExecution("vision")).toBe(false);
      expect(provider.supportsExecution("structured-output")).toBe(false);
    });

    it("still throws NOT_IMPLEMENTED for generateStructured and embed", async () => {
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), makeClient());
      await expect(
        provider.generateStructured("gemini-3.5-flash", "hello", "schema"),
      ).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "NOT_IMPLEMENTED" }) }),
      );
      await expect(provider.embed("gemini-3.5-flash", "hello")).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "NOT_IMPLEMENTED" }) }),
      );
    });
  });

  describe("generateText — pre-execution validation", () => {
    it("throws PROVIDER_NOT_CONFIGURED when no credential is set, and never calls the client", async () => {
      const client = makeClient();
      const provider = new GeminiProvider(makeEnv(), client);

      await expect(provider.generateText("gemini-3.5-flash", "hi")).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ code: "PROVIDER_NOT_CONFIGURED" }),
        }),
      );
      expect(client.models.generateContent).not.toHaveBeenCalled();
    });

    it("throws MODEL_NOT_FOUND for an unregistered model id, and never calls the client", async () => {
      const client = makeClient();
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), client);

      await expect(provider.generateText("no-such-model", "hi")).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "MODEL_NOT_FOUND" }) }),
      );
      expect(client.models.generateContent).not.toHaveBeenCalled();
    });

    it("rejects a model id that belongs to a different provider, and never calls the client", async () => {
      const client = makeClient();
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), client);

      // A real, registered model id — but from Anthropic, not Gemini.
      await expect(provider.generateText("claude-sonnet-5", "hi")).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "MODEL_NOT_FOUND" }) }),
      );
      expect(client.models.generateContent).not.toHaveBeenCalled();
    });
  });

  describe("generateText — success", () => {
    it("returns the response text and calls the SDK with the expected request shape", async () => {
      const client = makeClient();
      client.models.generateContent.mockResolvedValue({ text: "Hello, world!" });
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), client);

      const result = await provider.generateText("gemini-3.5-flash", "Say hello");

      expect(result).toBe("Hello, world!");
      expect(client.models.generateContent).toHaveBeenCalledWith({
        model: "gemini-3.5-flash",
        contents: "Say hello",
        config: { maxOutputTokens: 4096 },
      });
    });

    it("trims surrounding whitespace from the response text", async () => {
      const client = makeClient();
      client.models.generateContent.mockResolvedValue({ text: "  Hello, world!  " });
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), client);

      const result = await provider.generateText("gemini-2.5-pro", "hi");
      expect(result).toBe("Hello, world!");
    });
  });

  describe("generateText — empty/unsupported response", () => {
    it("throws PROVIDER_RESPONSE_INVALID when the SDK's text getter returns undefined", async () => {
      const client = makeClient();
      client.models.generateContent.mockResolvedValue({ text: undefined });
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), client);

      await expect(provider.generateText("gemini-3.5-flash", "hi")).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ code: "PROVIDER_RESPONSE_INVALID" }),
        }),
      );
    });

    it("throws PROVIDER_RESPONSE_INVALID when the only text is empty/whitespace", async () => {
      const client = makeClient();
      client.models.generateContent.mockResolvedValue({ text: "   " });
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), client);

      await expect(provider.generateText("gemini-3.5-flash", "hi")).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ code: "PROVIDER_RESPONSE_INVALID" }),
        }),
      );
    });
  });

  describe("generateText — SDK error normalization", () => {
    it.each([
      [new ApiError({ message: "auth", status: 401 }), "PROVIDER_AUTH_FAILED"],
      [new ApiError({ message: "denied", status: 403 }), "PROVIDER_AUTH_FAILED"],
      [new ApiError({ message: "rate limited", status: 429 }), "PROVIDER_RATE_LIMITED"],
      [new ApiError({ message: "bad request", status: 400 }), "PROVIDER_REQUEST_INVALID"],
      [new ApiError({ message: "internal error", status: 500 }), "PROVIDER_UNAVAILABLE"],
      [new Error("totally unexpected"), "PROVIDER_UNAVAILABLE"],
    ] as const)("maps %p to %s", async (thrown, expectedCode) => {
      const client = makeClient();
      client.models.generateContent.mockRejectedValue(thrown);
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), client);

      await expect(provider.generateText("gemini-3.5-flash", "hi")).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: expectedCode }) }),
      );
    });

    it("never leaks the raw SDK error message in the normalized error", async () => {
      const client = makeClient();
      client.models.generateContent.mockRejectedValue(
        new ApiError({ message: "leaked-secret-detail-should-not-appear", status: 400 }),
      );
      const provider = new GeminiProvider(makeEnv({ GEMINI_API_KEY: "test-key" }), client);

      await expect(provider.generateText("gemini-3.5-flash", "hi")).rejects.not.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({
            message: expect.stringContaining("leaked-secret-detail-should-not-appear"),
          }),
        }),
      );
    });
  });
});
