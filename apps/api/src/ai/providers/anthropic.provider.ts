import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type { ModelMetadata, ProviderCapability } from "@omniscience/types";
import { ENV } from "../../config/config.constants";
import { StubProviderDescriptor } from "./stub-provider.base";

/**
 * Anthropic — metadata-only stub descriptor (Phase 4 Step 1). No
 * `@anthropic-ai/sdk` dependency exists in this package; every
 * execution method throws `NOT_IMPLEMENTED` via the shared base class.
 * `configStatus()` reflects only whether `ANTHROPIC_API_KEY` is
 * present.
 */
@Injectable()
export class AnthropicProvider extends StubProviderDescriptor {
  readonly providerId = "anthropic";
  readonly displayName = "Anthropic";
  readonly capabilities: readonly ProviderCapability[] = [
    "text-generation",
    "vision",
    "structured-output",
    "tool-calling",
    "streaming",
  ];
  readonly priority = 15;

  protected readonly models: readonly ModelMetadata[] = [
    {
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      displayName: "Claude Sonnet 5",
      capabilities: [
        "text-generation",
        "vision",
        "structured-output",
        "tool-calling",
        "streaming",
      ],
      availability: "available",
      priority: 10,
      contextWindowTokens: 200_000,
    },
    {
      providerId: "anthropic",
      modelId: "claude-haiku-4-5",
      displayName: "Claude Haiku 4.5",
      capabilities: ["text-generation", "structured-output", "tool-calling", "streaming"],
      availability: "available",
      priority: 25,
      contextWindowTokens: 200_000,
    },
  ];

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  protected hasCredential(): boolean {
    return this.env.ANTHROPIC_API_KEY !== undefined;
  }
}
