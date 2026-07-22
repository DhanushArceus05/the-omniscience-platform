import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "@omniscience/config";
import type { AnthropicMessagesClient } from "./anthropic-client.provider";
import { AnthropicProvider } from "./anthropic.provider";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { ...overrides } as unknown as Env;
}

interface FakeAnthropicClient extends AnthropicMessagesClient {
  readonly messages: { readonly create: jest.Mock };
}

function makeClient(): FakeAnthropicClient {
  return { messages: { create: jest.fn() } };
}

function textMessage(text: string): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as unknown as Anthropic.Message;
}

describe("AnthropicProvider", () => {
  describe("metadata (unchanged Step 1 conventions)", () => {
    it("advertises only text-generation — no unimplemented capability is claimed", () => {
      const provider = new AnthropicProvider(makeEnv(), makeClient());
      expect(provider.capabilities).toEqual(["text-generation"]);
      for (const model of provider.listModels()) {
        expect(model.capabilities).toEqual(["text-generation"]);
        expect(model.providerId).toBe("anthropic");
      }
    });

    it("reports not-configured / not-ready when ANTHROPIC_API_KEY is unset", () => {
      const provider = new AnthropicProvider(makeEnv(), makeClient());
      expect(provider.configStatus()).toBe("not-configured");
      expect(provider.isReady()).toBe(false);
    });

    it("reports configured / ready when ANTHROPIC_API_KEY is set", () => {
      const provider = new AnthropicProvider(
        makeEnv({ ANTHROPIC_API_KEY: "test-key" }),
        makeClient(),
      );
      expect(provider.configStatus()).toBe("configured");
      expect(provider.isReady()).toBe(true);
    });

    it("never returns its own API key value from any public method", () => {
      const secretValue = "super-secret-anthropic-key-value";
      const provider = new AnthropicProvider(
        makeEnv({ ANTHROPIC_API_KEY: secretValue }),
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

    it("still throws NOT_IMPLEMENTED for generateStructured and embed", async () => {
      const provider = new AnthropicProvider(
        makeEnv({ ANTHROPIC_API_KEY: "test-key" }),
        makeClient(),
      );
      await expect(
        provider.generateStructured("claude-sonnet-5", "hello", "schema"),
      ).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "NOT_IMPLEMENTED" }) }),
      );
      await expect(provider.embed("claude-sonnet-5", "hello")).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "NOT_IMPLEMENTED" }) }),
      );
    });
  });

  describe("generateText — pre-execution validation", () => {
    it("throws PROVIDER_NOT_CONFIGURED when no credential is set, and never calls the client", async () => {
      const client = makeClient();
      const provider = new AnthropicProvider(makeEnv(), client);

      await expect(provider.generateText("claude-sonnet-5", "hi")).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ code: "PROVIDER_NOT_CONFIGURED" }),
        }),
      );
      expect(client.messages.create).not.toHaveBeenCalled();
    });

    it("throws MODEL_NOT_FOUND for an unregistered model id, and never calls the client", async () => {
      const client = makeClient();
      const provider = new AnthropicProvider(makeEnv({ ANTHROPIC_API_KEY: "test-key" }), client);

      await expect(provider.generateText("no-such-model", "hi")).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "MODEL_NOT_FOUND" }) }),
      );
      expect(client.messages.create).not.toHaveBeenCalled();
    });

    it("rejects a model id that belongs to a different provider, and never calls the client", async () => {
      const client = makeClient();
      const provider = new AnthropicProvider(makeEnv({ ANTHROPIC_API_KEY: "test-key" }), client);

      // A real, registered model id — but from Gemini/OpenAI, not Anthropic.
      await expect(provider.generateText("gpt-4o", "hi")).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: "MODEL_NOT_FOUND" }) }),
      );
      expect(client.messages.create).not.toHaveBeenCalled();
    });
  });

  describe("generateText — success", () => {
    it("returns the joined text content and calls the SDK with the expected request shape", async () => {
      const client = makeClient();
      client.messages.create.mockResolvedValue(textMessage("Hello, world!"));
      const provider = new AnthropicProvider(makeEnv({ ANTHROPIC_API_KEY: "test-key" }), client);

      const result = await provider.generateText("claude-sonnet-5", "Say hello");

      expect(result).toBe("Hello, world!");
      expect(client.messages.create).toHaveBeenCalledWith({
        model: "claude-sonnet-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: "Say hello" }],
      });
    });

    it("joins multiple text blocks and trims surrounding whitespace", async () => {
      const client = makeClient();
      client.messages.create.mockResolvedValue({
        ...textMessage(""),
        content: [
          { type: "text", text: "  Part one. ", citations: null },
          { type: "text", text: "Part two.  ", citations: null },
        ],
      } as unknown as Anthropic.Message);
      const provider = new AnthropicProvider(makeEnv({ ANTHROPIC_API_KEY: "test-key" }), client);

      const result = await provider.generateText("claude-haiku-4-5", "hi");
      // Blocks are joined with no added separator (`join("")`), then the
      // whole result is trimmed — only the outer whitespace disappears,
      // the single space already between the two blocks is preserved.
      expect(result).toBe("Part one. Part two.");
    });
  });

  describe("generateText — empty/unsupported response", () => {
    it("throws PROVIDER_RESPONSE_INVALID when there is no text content block", async () => {
      const client = makeClient();
      client.messages.create.mockResolvedValue({
        ...textMessage(""),
        content: [],
      } as unknown as Anthropic.Message);
      const provider = new AnthropicProvider(makeEnv({ ANTHROPIC_API_KEY: "test-key" }), client);

      await expect(provider.generateText("claude-sonnet-5", "hi")).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ code: "PROVIDER_RESPONSE_INVALID" }),
        }),
      );
    });

    it("throws PROVIDER_RESPONSE_INVALID when the only text block is empty/whitespace", async () => {
      const client = makeClient();
      client.messages.create.mockResolvedValue(textMessage("   "));
      const provider = new AnthropicProvider(makeEnv({ ANTHROPIC_API_KEY: "test-key" }), client);

      await expect(provider.generateText("claude-sonnet-5", "hi")).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ code: "PROVIDER_RESPONSE_INVALID" }),
        }),
      );
    });
  });

  describe("generateText — SDK error normalization", () => {
    const headers = new Headers();

    it.each([
      [new Anthropic.AuthenticationError(401, {}, "auth", headers), "PROVIDER_AUTH_FAILED"],
      [new Anthropic.PermissionDeniedError(403, {}, "denied", headers), "PROVIDER_AUTH_FAILED"],
      [new Anthropic.RateLimitError(429, {}, "rate limited", headers), "PROVIDER_RATE_LIMITED"],
      [new Anthropic.BadRequestError(400, {}, "bad request", headers), "PROVIDER_REQUEST_INVALID"],
      [
        new Anthropic.UnprocessableEntityError(422, {}, "unprocessable", headers),
        "PROVIDER_REQUEST_INVALID",
      ],
      [
        new Anthropic.InternalServerError(500, {}, "internal error", headers),
        "PROVIDER_UNAVAILABLE",
      ],
      [
        new Anthropic.APIConnectionTimeoutError({ message: "timed out" }),
        "PROVIDER_TIMEOUT",
      ],
      [
        new Anthropic.APIConnectionError({ message: "connection failed" }),
        "PROVIDER_UNAVAILABLE",
      ],
      [new Error("totally unexpected"), "PROVIDER_UNAVAILABLE"],
    ] as const)("maps %p to %s", async (thrown, expectedCode) => {
      const client = makeClient();
      client.messages.create.mockRejectedValue(thrown);
      const provider = new AnthropicProvider(makeEnv({ ANTHROPIC_API_KEY: "test-key" }), client);

      await expect(provider.generateText("claude-sonnet-5", "hi")).rejects.toEqual(
        expect.objectContaining({ response: expect.objectContaining({ code: expectedCode }) }),
      );
    });

    it("never leaks the raw SDK error body, headers, or message text in the normalized error", async () => {
      const secretLookingBody = { message: "leaked-secret-detail-should-not-appear" };
      const client = makeClient();
      client.messages.create.mockRejectedValue(
        new Anthropic.BadRequestError(400, secretLookingBody, "leaked-secret-detail-should-not-appear", headers),
      );
      const provider = new AnthropicProvider(makeEnv({ ANTHROPIC_API_KEY: "test-key" }), client);

      await expect(provider.generateText("claude-sonnet-5", "hi")).rejects.not.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({
            message: expect.stringContaining("leaked-secret-detail-should-not-appear"),
          }),
        }),
      );
    });
  });
});
