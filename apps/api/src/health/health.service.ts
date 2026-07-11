import { Injectable } from "@nestjs/common";
import type { HealthCheckResponse } from "@omniscience/types";

@Injectable()
export class HealthService {
  private readonly startedAt = process.hrtime.bigint();
  private readonly version = process.env["npm_package_version"] ?? "0.1.0";

  getHealth(): HealthCheckResponse {
    const elapsedNs = process.hrtime.bigint() - this.startedAt;
    const uptimeSeconds = Number(elapsedNs) / 1_000_000_000;

    return {
      status: "ok",
      service: "api",
      version: this.version,
      timestamp: new Date().toISOString(),
      uptimeSeconds,
    };
  }
}
