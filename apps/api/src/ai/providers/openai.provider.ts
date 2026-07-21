import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type { ModelMetadata, ProviderCapability } from "@omniscience/types";
import { ENV } from "../../config/config.constants";
import { StubProviderDescriptor } from "./stub-provider.base";

/**
 * OpenAI — metadata-only stub descriptor (Phase 4 Step 1). No `openai`
 * SDK dependency exists in this package; every execution method throws
 * `NOT_IMPLEMENTED` via the shared base class. `configStatus()`
 * reflects only whether `OPENAI_API_KEY` is present.
 */
@Injectable()
export class OpenAiProvider extends StubProviderDescriptor {
  readonly providerId = "openai";
  readonly displayName = "OpenAI";
  readonly capabilities: readonly ProviderCapability[] = [
    "text-generation",
    "embeddings",
    "vision",
    "speech-to-text",
    "text-to-speech",
    "structured-output",
    "tool-calling",
    "streaming",
  ];
  readonly priority = 20;

  protected readonly models: readonly ModelMetadata[] = [
    {
      providerId: "openai",
      modelId: "gpt-4o",
      displayName: "GPT-4o",
      capabilities: [
        "text-generation",
        "vision",
        "structured-output",
        "tool-calling",
        "streaming",
      ],
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
      modelId: "text-embedding-3-large",
      displayName: "Text Embedding 3 Large",
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
}
