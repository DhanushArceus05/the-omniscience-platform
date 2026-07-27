import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { AuthModule } from "../auth/auth.module";
import { CapabilityPlanBuilderService } from "./capability-plan-builder.service";
import { ComplexityEstimatorService } from "./complexity-estimator.service";
import { DependencyGraphService } from "./dependency-graph.service";
import { ExecutionStageBuilderService } from "./execution-stage-builder.service";
import { FastRulesEngineService } from "./fast-rules-engine.service";
import { OmniCoreController } from "./omnicore.controller";
import { OmniCoreService } from "./omnicore.service";
import { PlanValidatorService } from "./plan-validator.service";
import { TaskPlannerService } from "./task-planner.service";

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
 *
 * Phase 5 Step 3 ("production-grade task planning engine") adds five
 * more internal providers — `DependencyGraphService`,
 * `PlanValidatorService`, `ComplexityEstimatorService`,
 * `ExecutionStageBuilderService`, and `TaskPlannerService` — wired
 * together the same way the Step 1/2 services already are:
 * `TaskPlannerService` is the only one `OmniCoreService` depends on
 * directly, the same "one seam, not a parallel copy" shape
 * `OmniCoreService` already follows for `ModelSelectorService`/
 * `ProviderRegistryService`. None of the five needs a new import,
 * dependency, or export beyond each other and `@omniscience/types` —
 * task planning is derived entirely from the `CapabilityPlan`
 * `CapabilityPlanBuilderService` already builds, never a new external
 * dependency.
 */
@Module({
  imports: [AuthModule, AiModule],
  controllers: [OmniCoreController],
  providers: [
    FastRulesEngineService,
    CapabilityPlanBuilderService,
    DependencyGraphService,
    PlanValidatorService,
    ComplexityEstimatorService,
    ExecutionStageBuilderService,
    TaskPlannerService,
    OmniCoreService,
  ],
})
export class OmniCoreModule {}
