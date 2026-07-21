import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import type { ModelMetadata, ProviderCapability } from "@omniscience/types";
import { ENV } from "../../config/config.constants";
import { StubProviderDescriptor } from "./stub-provider.base";

/**
 * Google Gemini — metadata-only stub descriptor (Phase 4 Step 1). No
 * `@google/generative-ai` (or any Gemini SDK) dependency exists in this
 * package; every execution method throws `NOT_IMPLEMENTED` via the
 * shared base class. `configStatus()` reflects only whether
 * `GEMINI_API_KEY` is present — the key's value is never read for any
 * other purpose and never logged or returned from any endpoint.
 */
@Injectable()
export class GeminiProvider extends StubProviderDescriptor {
  readonly providerId = "gemini";
  readonly displayName = "Google Gemini";
  readonly capabilities: readonly ProviderCapability[] = [
    "text-generation",
    "vision",
    "structured-output",
    "tool-calling",
    "streaming",
  ];
  readonly priority = 10;

  protected readonly models: readonly ModelMetadata[] = [
    {
      providerId: "gemini",
      modelId: "gemini-1.5-flash",
      displayName: "Gemini 1.5 Flash",
      capabilities: ["text-generation", "vision", "structured-output", "streaming"],
      availability: "available",
      priority: 10,
      contextWindowTokens: 1_000_000,
    },
    {
      providerId: "gemini",
      modelId: "gemini-1.5-pro",
      displayName: "Gemini 1.5 Pro",
      capabilities: [
        "text-generation",
        "vision",
        "structured-output",
        "tool-calling",
        "streaming",
      ],
      availability: "available",
      priority: 20,
      contextWindowTokens: 2_000_000,
    },
  ];

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  protected hasCredential(): boolean {
    return this.env.GEMINI_API_KEY !== undefined;
  }
}
