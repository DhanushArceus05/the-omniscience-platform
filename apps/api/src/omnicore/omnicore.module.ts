import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { AuthModule } from "../auth/auth.module";
import { CapabilityPlanBuilderService } from "./capability-plan-builder.service";
import { FastRulesEngineService } from "./fast-rules-engine.service";
import { OmniCoreController } from "./omnicore.controller";
import { OmniCoreService } from "./omnicore.service";

/**
 * OmniCore module (Phase 5 Steps 1-2).
 *
 * Imports `AuthModule` to reuse its exported `JwtAuthGuard` — same
 * convention `AiModule`/`WorkspacesModule` already follow. Imports
 * `AiModule` to reuse its exported `ModelSelectorService`/
 * `ProviderRegistryService` rather than re-registering the provider
 * layer a second time — `AiModule` already seeds and owns the
 * registry/catalog via its own `AiProviderSeedService`; `OmniCoreModule`
 * never registers a provider or model of its own.
 *
 * Step 2 (intent intelligence: a richer `OmniCoreIntent` taxonomy,
 * confidence-based ambiguity detection, and per-intent capability
 * selection) is entirely internal to `FastRulesEngineService` and
 * `CapabilityPlanBuilderService` — no new dependency, provider,
 * import, or export was needed to add it.
 *
 * `FastRulesEngineService`/`CapabilityPlanBuilderService`/
 * `OmniCoreService` are internal to this module — nothing outside it
 * should import them directly, same "only the controller is public"
 * convention `AiModule` established for `AiService`. Nothing is
 * exported yet: no other module consumes OmniCore's own services this
 * step. A future phase (e.g. Phase 6's Omniscience Assistant) is
 * expected to export `OmniCoreService` here once it needs to call
 * OmniCore directly rather than through the HTTP boundary.
 */
@Module({
  imports: [AuthModule, AiModule],
  controllers: [OmniCoreController],
  providers: [FastRulesEngineService, CapabilityPlanBuilderService, OmniCoreService],
})
export class OmniCoreModule {}
