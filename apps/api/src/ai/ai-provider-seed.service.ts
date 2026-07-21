import { Injectable, type OnModuleInit } from "@nestjs/common";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { GeminiProvider } from "./providers/gemini.provider";
import { OpenAiProvider } from "./providers/openai.provider";
import { ModelCatalogService } from "./model-catalog.service";
import { ProviderRegistryService } from "./provider-registry.service";

/**
 * Registers every known `OmniProvider` stub descriptor (and each one's
 * models) into `ProviderRegistryService`/`ModelCatalogService` exactly
 * once, on module init. This is the *only* place any of the three
 * concrete provider classes are referenced by name — everything else in
 * the `ai` module (the controller, the selector) depends solely on the
 * `OmniProvider` interface and the registry/catalog, never on a
 * concrete class. Adding a fourth provider in a future phase means
 * adding one line here, not touching any other file in this module.
 */
@Injectable()
export class AiProviderSeedService implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly catalog: ModelCatalogService,
    private readonly gemini: GeminiProvider,
    private readonly openai: OpenAiProvider,
    private readonly anthropic: AnthropicProvider,
  ) {}

  onModuleInit(): void {
    for (const provider of [this.gemini, this.openai, this.anthropic]) {
      this.registry.register(provider);
      for (const model of provider.listModels()) {
        this.catalog.register(model);
      }
    }
  }
}
