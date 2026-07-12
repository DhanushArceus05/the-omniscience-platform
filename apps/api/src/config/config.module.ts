import { Global, Module } from "@nestjs/common";
import { loadEnv } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import { ENV, LOGGER } from "./config.constants";

/**
 * Loads and validates the environment exactly once and exposes it (plus a
 * shared structured logger tagged for this service) via dependency
 * injection, so every other module (Redis, Mail, and Phase 2's
 * upcoming Auth module) reads configuration the same validated way
 * instead of touching `process.env` directly.
 *
 * `main.ts` still calls `loadEnv()` itself for the values it needs before
 * the Nest application exists (CORS origin, port/host) — that pre-Nest
 * bootstrap code is unchanged from Phase 0. This module is for everything
 * that runs *inside* the Nest DI container.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: () => loadEnv(),
    },
    {
      provide: LOGGER,
      inject: [ENV],
      useFactory: (env: ReturnType<typeof loadEnv>) =>
        createLogger({ service: "api", level: env.LOG_LEVEL }),
    },
  ],
  exports: [ENV, LOGGER],
})
export class ConfigModule {}
