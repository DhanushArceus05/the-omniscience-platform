import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  omniCoreExecuteRequestSchema,
  type OmniCoreExecuteRequestSchema,
} from "@omniscience/schemas";
import type { ApiSuccess, OmniCoreExecuteResponse } from "@omniscience/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { OmniCoreService } from "./omnicore.service";

/**
 * `POST /omnicore/execute` — OmniCore's entry point (Phase 5 Steps
 * 1-2). Same access/throttle shape as `POST /ai/generate`
 * (`apps/api/src/ai/ai.controller.ts`): behind `JwtAuthGuard`, and a
 * tight explicit limit (10/10min) since every call is vendor-billed —
 * it ultimately makes a real, paid request to whichever provider
 * `OmniCoreService`'s classify → plan → select → execute pipeline
 * lands on.
 *
 * A `200` response returns only safe, non-secret data — generated
 * text plus OmniCore's own routing/confidence metadata (`planId`,
 * `intent`, `matchedRuleId`, `confidence`, `providerId`, `modelId`) —
 * never a raw `CapabilityPlan`, the matched *selector* rule, or any
 * other internal detail beyond what `OmniCoreService.execute()`
 * already returns. A `422` response (Step 2) means the prompt was
 * genuinely ambiguous between intents (`AMBIGUOUS_INTENT`, with the
 * candidate `alternateIntents` in the body) rather than an error on
 * the caller's part.
 */
@Controller("omnicore")
export class OmniCoreController {
  constructor(private readonly omniCore: OmniCoreService) {}

  /**
   * `intent`/`plan`/`matchedRuleId`/`confidence` are never accepted in
   * the request body — `omniCoreExecuteRequestSchema` is `.strict()`,
   * so a caller sending any of them gets a `VALIDATION_ERROR` rather
   * than the field being silently ignored. OmniCore's own fast-rules
   * classification always decides these, never the caller.
   */
  @Post("execute")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async execute(
    @Body(new ZodValidationPipe(omniCoreExecuteRequestSchema)) body: OmniCoreExecuteRequestSchema,
  ): Promise<ApiSuccess<OmniCoreExecuteResponse>> {
    const data = await this.omniCore.execute(body.prompt);
    return { success: true, data };
  }
}
