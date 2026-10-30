import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type { ModelCapability, ModelMetadata, ProviderCapability } from "@omniscience/types";
import { ENV } from "../../config/config.constants";
import { aiDomainError } from "../ai-provider.interface";
import { StubProviderDescriptor } from "./stub-provider.base";

/**
 * OpenAI embedding adapter. Knowledge embedding calls stay behind the
 * existing OmniProvider contract and use the provider's native batch API.
 * Other OpenAI capabilities remain unimplemented.
 */
@Injectable()
export class OpenAiProvider extends StubProviderDescriptor {
  readonly providerId = "openai";
  readonly displayName = "OpenAI";
  readonly capabilities: readonly ProviderCapability[] = [
    "text-generation", "embeddings", "vision", "speech-to-text", "text-to-speech", "structured-output", "tool-calling", "streaming",
  ];
  readonly priority = 20;

  protected readonly models: readonly ModelMetadata[] = [
    {
      providerId: "openai",
      modelId: "gpt-4o",
      displayName: "GPT-4o",
      capabilities: ["text-generation", "vision", "structured-output", "tool-calling", "streaming"],
      availability: "available",
      priority: 10,
      contextWindowTokens: 128_000,
    },
    {
      providerId: "openai",
      modelId: "gpt-4o-mini",
      displayName: "GPT-4o mini",
      capabilities: ["text-generation", "structured-output", "tool-calling", "streaming"],
      availability: "available",
      priority: 15,
      contextWindowTokens: 128_000,
    },
    {
      providerId: "openai",
      modelId: "text-embedding-3-small",
      displayName: "Text Embedding 3 Small",
      capabilities: ["embeddings"],
      availability: "available",
      priority: 30,
      contextWindowTokens: 8_191,
    },
  ];

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  protected hasCredential(): boolean {
    return this.env.OPENAI_API_KEY !== undefined;
  }

  override supportsExecution(capability: ModelCapability): boolean {
    return capability === "embeddings";
  }

  override async embed(modelId: string, input: string): Promise<readonly number[]> {
    const results = await this.embedBatch(modelId, [input]);
    const embedding = results.find((item) => item.index === 0)?.embedding;
    if (!embedding) throw aiDomainError("PROVIDER_RESPONSE_INVALID", "The embedding provider returned an invalid response.");
    return embedding;
  }

  async embedBatch(
    modelId: string,
    input: readonly string[],
  ): Promise<readonly { index: number; embedding: readonly number[] }[]> {
    if (modelId !== "text-embedding-3-small") {
      throw aiDomainError("PROVIDER_REQUEST_INVALID", "The requested embedding model is not supported.");
    }
    if (!input.length) return [];
    if (!this.env.OPENAI_API_KEY) {
      throw aiDomainError("PROVIDER_NOT_CONFIGURED", "The embedding provider is not configured.");
    }

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, input }),
        signal: AbortSignal.timeout(this.env.AI_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw aiDomainError("PROVIDER_UNAVAILABLE", "The embedding provider is temporarily unavailable.");
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw aiDomainError("PROVIDER_AUTH_FAILED", "The embedding provider rejected its credentials.");
      if (response.status === 429) throw aiDomainError("PROVIDER_RATE_LIMITED", "The embedding provider is rate limited.");
      if (response.status >= 500) throw aiDomainError("PROVIDER_UNAVAILABLE", "The embedding provider is temporarily unavailable.");
      throw aiDomainError("PROVIDER_REQUEST_INVALID", "The embedding request was rejected.");
    }

    try {
      const body: unknown = await response.json();
      if (!isEmbeddingResponse(body)) throw new Error("invalid response");
      return body.data.map(({ index, embedding }) => ({ index, embedding }));
    } catch {
      throw aiDomainError("PROVIDER_RESPONSE_INVALID", "The embedding provider returned an invalid response.");
    }
  }
}

function isEmbeddingResponse(value: unknown): value is { data: Array<{ index: number; embedding: number[] }> } {
  if (typeof value !== "object" || value === null || !("data" in value) || !Array.isArray(value.data)) return false;
  return value.data.every((entry) => typeof entry === "object" && entry !== null &&
    "index" in entry && Number.isInteger(entry.index) && "embedding" in entry && Array.isArray(entry.embedding) &&
    entry.embedding.every((coordinate: unknown) => typeof coordinate === "number" && Number.isFinite(coordinate)));
}
