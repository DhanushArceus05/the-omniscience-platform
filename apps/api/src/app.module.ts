import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";

/**
 * Root module for Phase 0 — Foundation.
 * Only cross-cutting infrastructure (health) is wired here.
 * Authentication, workspaces and business modules are added in
 * their respective approved phases (docs/08_Development_Roadmap.md).
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
