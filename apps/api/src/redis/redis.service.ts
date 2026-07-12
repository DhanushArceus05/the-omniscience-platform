import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import Redis from "ioredis";
import type { Logger } from "pino";
import { ENV, LOGGER } from "../config/config.constants";

/**
 * Thin wrapper around a single shared ioredis client.
 *
 * Used from Phase 2 Step 3 onward for OTP storage and from Step 4 onward
 * for refresh-token storage/revocation (per the approved Phase 2
 * decisions). Step 1 only establishes the connection and lifecycle; no
 * OTP/session-specific key logic lives here — that belongs in the auth
 * module so this service stays a generic, reusable Redis client.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.client = new Redis(env.REDIS_URL, {
      // Fail fast on unreachable Redis instead of buffering commands
      // silently (Claude Development Rule 5: no silent failures).
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on("error", (err: Error) => {
      this.logger.error({ err: err.message }, "redis client error");
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.info("redis connected");
  }

  onModuleDestroy(): void {
    this.client.disconnect();
    this.logger.info("redis disconnected");
  }

  /**
   * Exposes the underlying ioredis client for feature modules. Kept as a
   * single accessor (rather than re-wrapping every Redis command) so this
   * service doesn't have to anticipate every command future steps need.
   */
  getClient(): Redis {
    return this.client;
  }
}
