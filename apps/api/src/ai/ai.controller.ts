import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  generateTextRequestSchema,
  listModelsQuerySchema,
  type GenerateTextRequestSchema,
  type ListModelsQuerySchema,
} from "@omniscience/schemas";
import type {
  ApiSuccess,
  GenerateTextResponse,
  ListModelsResponse,
  ListProvidersResponse,
} from "@omniscience/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AiService } from "./ai.service";
import { ModelCatalogService } from "./model-catalog.service";
import { ProviderRegistryService } from "./provider-registry.service";

/**
 * OmniProvider / Model Manager endpoints. `GET /ai/providers` and
 * `GET /ai/models` are Phase 4 Step 1 diagnostic reads; `POST
 * /ai/generate` (Phase 4 Step 3) is the first endpoint that actually
 * executes a model.
 *
 * All three routes sit behind `JwtAuthGuard` — same convention
 * `WorkspacesController`'s routes established. The two `GET`s carry no
 * `@Throttle()` override, since they carry no credential and the
 * app-wide default (60/60s per IP) is the right limit. `POST
 * /ai/generate` gets an explicit, tighter limit (10/10min): unlike the
 * `GET`s, every call is vendor-billed — it makes a real, paid request
 * to whichever provider `ModelSelectorService` selects.
 *
 * Every response returns only safe, non-secret metadata (ids,
 * capabilities, config/availability status, generated text) — never an
 * API key or any other environment value. See
 * `provider-registry.service.ts`'s `listMetadata()` and
 * `model-catalog.service.ts`'s `list()`, neither of which ever touches
 * `Env` directly, and `AiService.generate()`, which returns only
 * `{ text, providerId, modelId }` — never `matchedRule` or any other
 * internal routing/debug metadata.
 */
@Controller("ai")
export class AiController {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly catalog: ModelCatalogService,
    private readonly aiService: AiService,
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

  /**
   * `requiredCapabilities`/`preferredProviderId`/`preferredModelId` are
   * never accepted here — `generateTextRequestSchema` is `.strict()`,
   * so a caller sending any of them gets a `VALIDATION_ERROR` rather
   * than the field being silently ignored. `AiService.generate()` is
   * the only place `["text-generation"]` is requested internally.
   */
  @Post("generate")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async generate(
    @Body(new ZodValidationPipe(generateTextRequestSchema)) body: GenerateTextRequestSchema,
  ): Promise<ApiSuccess<GenerateTextResponse>> {
    const data = await this.aiService.generate(body.prompt);
    return { success: true, data };
  }
}
