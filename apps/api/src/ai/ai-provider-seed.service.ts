import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Logger } from "pino";
import { LOGGER } from "../config/config.constants";
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
 *
 * Phase 4 Step 5 (production hardening): logs a one-line, secret-free
 * summary of what got registered — every provider id and its
 * `configStatus()` — at `info` on every boot, and a `warn` if not a
 * single registered provider is both ready and genuinely
 * execution-capable for at least one capability. Startup is the
 * cheapest possible moment to catch "this deployment has no usable AI
 * provider configured at all" — the alternative is discovering it only
 * when the first real user request hits `NO_COMPATIBLE_MODEL`. Never
 * logs a credential value; `configStatus()` only ever reports
 * `"configured"`/`"not-configured"`.
 */
@Injectable()
export class AiProviderSeedService implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly catalog: ModelCatalogService,
    private readonly gemini: GeminiProvider,
    private readonly openai: OpenAiProvider,
    private readonly anthropic: AnthropicProvider,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    const providers = [this.gemini, this.openai, this.anthropic];

    for (const provider of providers) {
      this.registry.register(provider);
      for (const model of provider.listModels()) {
        this.catalog.register(model);
      }
    }

    const summary = providers.map((provider) => ({
      providerId: provider.providerId,
      configStatus: provider.configStatus(),
    }));
    this.logger.info(
      { providers: summary, modelCount: this.catalog.list().length },
      "ai: provider registry seeded",
    );

    // "Ready" alone isn't enough — a metadata-only stub with a
    // configured API key is `isReady() === true` but still has no real
    // execution path for anything (see `OmniProvider.supportsExecution`
    // and `ModelSelectorService`'s execution-eligibility check). A
    // deployment where every configured provider is still a stub would
    // otherwise look healthy here and then fail every real request with
    // NO_COMPATIBLE_MODEL — flag that at boot instead.
    const hasAnyExecutionCapableProvider = providers.some(
      (provider) => provider.isReady() && provider.capabilities.some((capability) => provider.supportsExecution(capability)),
    );
    if (!hasAnyExecutionCapableProvider) {
      this.logger.warn(
        { providers: summary },
        "ai: no registered provider is both configured and execution-capable — POST /ai/generate will fail with NO_COMPATIBLE_MODEL until at least one real provider's API key is set",
      );
    }
  }
}
