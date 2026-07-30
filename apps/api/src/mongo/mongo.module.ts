import { Global, Module } from "@nestjs/common";
import { MongoService } from "./mongo.service";

/**
 * Global so every feature module (today: `ConversationsModule`; future
 * ones as later Phase 6+ steps need Mongo-backed storage) can inject
 * `MongoService` without re-importing this module everywhere — same
 * convention `PrismaModule`/`RedisModule` already established.
 */
@Global()
@Module({
  providers: [MongoService],
  exports: [MongoService],
})
export class MongoModule {}
