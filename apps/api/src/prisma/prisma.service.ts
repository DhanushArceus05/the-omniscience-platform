import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { LOGGER } from "../config/config.constants";

/**
 * Thin wrapper around the generated Prisma client that plugs into Nest's
 * module lifecycle so the pool connects on startup and disconnects
 * cleanly on shutdown (main.ts already calls `app.enableShutdownHooks()`
 * from Phase 0, so `onModuleDestroy` is guaranteed to run).
 *
 * No data models exist yet (Phase 2 Step 1 is infrastructure-only; models
 * arrive in Step 2), so this service currently has no query methods
 * beyond what `PrismaClient` provides directly.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {
    super({
      log: [
        { emit: "event", level: "warn" },
        { emit: "event", level: "error" },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    // Subclassing PrismaClient loses the literal `log` generic that would
    // normally type `$on`'s event names, so a narrow, explicit cast is
    // justified here rather than suppressing the check with `any`.
    type PrismaEventEmitter = {
      $on: (event: "warn" | "error", cb: (e: { message: string }) => void) => void;
    };
    const emitter = this as unknown as PrismaEventEmitter;
    emitter.$on("warn", (e) => this.logger.warn({ err: e.message }, "prisma warning"));
    emitter.$on("error", (e) => this.logger.error({ err: e.message }, "prisma error"));

    await this.$connect();
    this.logger.info("prisma connected to postgres");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.info("prisma disconnected from postgres");
  }
}
