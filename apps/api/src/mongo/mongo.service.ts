import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { MongoClient } from "mongodb";
import type { Db } from "mongodb";
import type { Logger } from "pino";
import { ENV, LOGGER } from "../config/config.constants";

/**
 * Thin wrapper around a single shared native MongoDB client (Phase 6
 * Step 1 — Conversation & Message Persistence Foundation).
 *
 * Mirrors `RedisService`'s exact shape: connects lazily in
 * `onModuleInit`, disconnects in `onModuleDestroy`, logs connect/
 * disconnect/errors via the shared structured `LOGGER`, and exposes a
 * single accessor (`getDb()`) rather than re-wrapping every driver
 * method — the same "one seam, not a parallel copy" reasoning
 * `RedisService.getClient()` already follows.
 *
 * `MONGO_URL` has been a required, validated `Env` field since Phase 0
 * (`packages/config/src/env.ts`) and `mongo:7` has been provisioned in
 * `docker-compose.yml` since the same phase — this is the first module
 * to actually construct a client against it. No ODM (e.g. Mongoose) is
 * introduced: the repository layer above this service (see
 * `../conversations/conversations.repository.ts`) uses the native
 * driver's typed `Collection<T>` directly, the same preference for
 * explicit, typed code over framework magic `PrismaService` already
 * reflects for Postgres.
 *
 * The database name is taken from `MONGO_URL`'s own path component
 * (the driver's default `client.db()` behavior) rather than a second,
 * separately configured `MONGO_DB` env var read here — `MONGO_URL`
 * already fully describes which database to use, and reading it twice
 * from two different places would risk the two drifting apart.
 */
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly client: MongoClient;
  private readonly db: Db;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.client = new MongoClient(env.MONGO_URL);
    this.db = this.client.db();

    this.client.on("error", (err: Error) => {
      this.logger.error({ err: err.message }, "mongo client error");
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.info("mongo connected");
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
    this.logger.info("mongo disconnected");
  }

  /**
   * Exposes the underlying database handle for feature modules — kept
   * as a single accessor (rather than re-wrapping every collection)
   * so this service doesn't have to anticipate every collection a
   * future step needs, exactly as `RedisService.getClient()` doesn't
   * anticipate every Redis command a future step needs.
   */
  getDb(): Db {
    return this.db;
  }
}
