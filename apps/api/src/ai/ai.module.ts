import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiController } from "./ai.controller";
import { AiProviderSeedService } from "./ai-provider-seed.service";
import { AiService } from "./ai.service";
import { ModelCatalogService } from "./model-catalog.service";
import { ModelSelectorService } from "./model-selector.service";
import { anthropicClientProvider } from "./providers/anthropic-client.provider";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { geminiClientProvider } from "./providers/gemini-client.provider";
import { GeminiProvider } from "./providers/gemini.provider";
import { OpenAiProvider } from "./providers/openai.provider";
import { ProviderRegistryService } from "./provider-registry.service";

/**
 * OmniProvider & Model Manager foundation module (Phase 4 Step 1).
 * Imports `AuthModule` to reuse its exported `JwtAuthGuard` — same
 * convention `WorkspacesModule` (Phase 3 Step 2) already follows.
 *
 * `AiProviderSeedService` registers the three provider descriptors (and
 * their models) into `ProviderRegistryService`/`ModelCatalogService` on
 * module init — see that service's doc comment. The concrete provider
 * classes and the seed service are internal implementation details of
 * this module; nothing outside it should ever import them directly.
 * `ModelSelectorService` is exported so a future module (e.g. OmniCore
 * in Phase 5) can request a model selection without re-implementing the
 * algorithm — the same "export the one reusable service" reasoning
 * `AuthModule`'s exports already follow.
 *
 * Phase 4 Step 2: `AnthropicProvider` is now the first *real* adapter
 * (`generateText` only — see that class's doc comment). It depends on
 * `ANTHROPIC_CLIENT`, provided here by `anthropicClientProvider`
 * (`providers/anthropic-client.provider.ts`) via a `useFactory` reading
 * the validated `Env`, so production resolves a real
 * `@anthropic-ai/sdk` client while tests can override the same token
 * with a fake. Gemini and OpenAI remain Step 1 metadata-only stubs,
 * unchanged.
 * Phase 4 Step 3: `AiService` is the thin, vendor-neutral orchestration
 * `AiController`'s new `POST /ai/generate` route depends on — it's the
 * only new file added to `providers` that step; `AiController`,
 * `ModelSelectorService`, `ProviderRegistryService`, and every provider
 * adapter registered below were unchanged. `AiService` is not exported:
 * it's reachable only through `AiController` within this module, same
 * as every concrete provider class already was.
 * Phase 4 Step 4: `GeminiProvider` is now the second *real* adapter
 * (`generateText` only — see that class's doc comment), following the
 * exact same shape Step 2 established for Anthropic. It depends on
 * `GEMINI_CLIENT`, provided here by `geminiClientProvider`
 * (`providers/gemini-client.provider.ts`) via a `useFactory` reading the
 * validated `Env`, so production resolves a real `@google/genai` client
 * while tests can override the same token with a fake. OpenAI remains a
 * Step 1 metadata-only stub, unchanged.
 */
@Module({
  imports: [AuthModule],
  controllers: [AiController],
  providers: [
    ProviderRegistryService,
    ModelCatalogService,
    ModelSelectorService,
    geminiClientProvider,
    GeminiProvider,
    OpenAiProvider,
    anthropicClientProvider,
    AnthropicProvider,
    AiProviderSeedService,
    AiService,
  ],
  exports: [ProviderRegistryService, ModelCatalogService, ModelSelectorService],
})
export class AiModule {}
