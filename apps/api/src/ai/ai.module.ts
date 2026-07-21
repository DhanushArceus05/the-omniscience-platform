import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiController } from "./ai.controller";
import { AiProviderSeedService } from "./ai-provider-seed.service";
import { ModelCatalogService } from "./model-catalog.service";
import { ModelSelectorService } from "./model-selector.service";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { GeminiProvider } from "./providers/gemini.provider";
import { OpenAiProvider } from "./providers/openai.provider";
import { ProviderRegistryService } from "./provider-registry.service";

/**
 * OmniProvider & Model Manager foundation module (Phase 4 Step 1).
 * Imports `AuthModule` to reuse its exported `JwtAuthGuard` — same
 * convention `WorkspacesModule` (Phase 3 Step 2) already follows.
 *
 * `AiProviderSeedService` registers the three stub provider descriptors
 * (and their models) into `ProviderRegistryService`/`ModelCatalogService`
 * on module init — see that service's doc comment. The three concrete
 * provider classes and the seed service are internal implementation
 * details of this module; nothing outside it should ever import them
 * directly. `ModelSelectorService` is exported so a future module (e.g.
 * OmniCore in Phase 5) can request a model selection without
 * re-implementing the algorithm — the same "export the one reusable
 * service" reasoning `AuthModule`'s exports already follow.
 */
@Module({
  imports: [AuthModule],
  controllers: [AiController],
  providers: [
    ProviderRegistryService,
    ModelCatalogService,
    ModelSelectorService,
    GeminiProvider,
    OpenAiProvider,
    AnthropicProvider,
    AiProviderSeedService,
  ],
  exports: [ProviderRegistryService, ModelCatalogService, ModelSelectorService],
})
export class AiModule {}
