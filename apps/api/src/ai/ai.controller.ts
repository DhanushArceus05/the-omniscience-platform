import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from "@nestjs/common";
import { listModelsQuerySchema, type ListModelsQuerySchema } from "@omniscience/schemas";
import type { ApiSuccess, ListModelsResponse, ListProvidersResponse } from "@omniscience/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ModelCatalogService } from "./model-catalog.service";
import { ProviderRegistryService } from "./provider-registry.service";

/**
 * OmniProvider / Model Manager diagnostic endpoints (Phase 4 Step 1).
 *
 * Both routes are authenticated reads behind `JwtAuthGuard` — same
 * convention `WorkspacesController`'s `GET` routes established — with
 * no `@Throttle()` override, since they carry no credential and the
 * app-wide default (60/60s per IP) is the right limit.
 *
 * Every response returns only safe, non-secret metadata (ids,
 * capabilities, config/availability status) — never an API key or any
 * other environment value. See `provider-registry.service.ts`'s
 * `listMetadata()` and `model-catalog.service.ts`'s `list()`, neither
 * of which ever touches `Env` directly.
 */
@Controller("ai")
export class AiController {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly catalog: ModelCatalogService,
  ) {}

  @Get("providers")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  getProviders(): ApiSuccess<ListProvidersResponse> {
    return { success: true, data: { providers: this.registry.listMetadata() } };
  }

  @Get("models")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  getModels(
    @Query(new ZodValidationPipe(listModelsQuerySchema)) query: ListModelsQuerySchema,
  ): ApiSuccess<ListModelsResponse> {
    let models = this.catalog.list();
    if (query.capability !== undefined) {
      models = this.catalog.filterByCapabilities([query.capability]);
    }
    if (query.provider !== undefined) {
      models = models.filter((model) => model.providerId === query.provider);
    }
    return { success: true, data: { models } };
  }
}
