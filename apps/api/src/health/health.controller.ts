import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import type { HealthCheckResponse } from "@omniscience/types";
import { HealthService } from "./health.service";

/**
 * Health endpoints are intentionally unwrapped (no ApiResponse envelope)
 * so they stay compatible with standard infra probes (Docker healthcheck,
 * Kubernetes liveness/readiness, uptime monitors).
 */
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  getHealth(): HealthCheckResponse {
    return this.healthService.getHealth();
  }
}
