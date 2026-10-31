import { Test, TestingModule } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import type Redis from "ioredis";
import { AccessTokenService } from "../auth/access-token.service";
import { AuthModule } from "../auth/auth.module";
import { AvatarModule } from "../avatar/avatar.module";
import { AvatarStorageService } from "../avatar/avatar-storage.service";
import { ENV, LOGGER } from "../config/config.constants";
import { ConfigModule } from "../config/config.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MailModule } from "../mail/mail.module";
import { MailService } from "../mail/mail.service";
import { MongoModule } from "../mongo/mongo.module";
import { MongoService } from "../mongo/mongo.service";
import { PasswordHasherService } from "../auth/password-hasher.service";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { RedisModule } from "../redis/redis.module";
import { RedisService } from "../redis/redis.service";
import { RefreshTokenStore } from "../auth/refresh-token.store";
import { UsersController } from "./users.controller";
import { UsersModule } from "./users.module";
import { UsersService } from "./users.service";

const testEnv = {
  OTP_TTL_SECONDS: 600,
  OTP_MAX_ATTEMPTS: 5,
  OTP_RESEND_COOLDOWN_SECONDS: 60,
  JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef",
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 604800,
  AVATAR_STORAGE_DIR: "./storage/avatars-test",
  AVATAR_PUBLIC_BASE_URL: "http://localhost:4000",
  AVATAR_MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  KNOWLEDGE_STORAGE_DIR: "./storage/knowledge-test",
  KNOWLEDGE_FILE_SIZE_LIMIT_MB: 25,
  KNOWLEDGE_EMBEDDING_BATCH_SIZE: 32,
  KNOWLEDGE_RETRIEVAL_LIMIT: 8,
  KNOWLEDGE_RETRIEVAL_MIN_SCORE: 0.35,
  KNOWLEDGE_RETRIEVAL_PER_FILE_LIMIT: 3,
  AI_REQUEST_TIMEOUT_MS: 30_000,
  QDRANT_URL: "http://localhost:6333",
} as unknown as Env;

describe("UsersModule", () => {
  it("compiles and provides UsersService, UsersController, and the AuthModule providers they depend on (including Step 8's RefreshTokenStore and Phase 3 Step 3's AvatarStorageService)", async () => {
    const module: TestingModule = await Test.createTestingModule({
      // Same rationale as auth.module.spec.ts: ConfigModule/PrismaModule/
      // RedisModule/MailModule/AvatarModule are all @Global(), but a
      // Nest testing module only registers global providers that are
      // actually part of its own compiled graph — they must be
      // imported here even though UsersModule/AuthModule never import
      // them directly (they rely on them being global in the real
      // AppModule).
      imports: [
        ConfigModule,
        PrismaModule,
        RedisModule,
        MailModule,
        MongoModule,
        AvatarModule,
        AuthModule,
        UsersModule,
      ],
    })
      .overrideProvider(ENV)
      .useValue(testEnv)
      .overrideProvider(LOGGER)
      .useValue(createLogger({ service: "api-test" }))
      .overrideProvider(PrismaService)
      .useValue({ user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } })
      .overrideProvider(RedisService)
      .useValue({
        getClient: () =>
          ({
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            eval: jest.fn(),
          }) as unknown as Redis,
      })
      .overrideProvider(MailService)
      .useValue({ sendMail: jest.fn(), isConfigured: () => false })
      .overrideProvider(MongoService)
      .useValue({ getDb: jest.fn() })
      .compile();

    expect(module.get(PasswordHasherService)).toBeInstanceOf(PasswordHasherService);
    expect(module.get(AccessTokenService)).toBeInstanceOf(AccessTokenService);
    expect(module.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    expect(module.get(RefreshTokenStore)).toBeInstanceOf(RefreshTokenStore);
    expect(module.get(AvatarStorageService)).toBeInstanceOf(AvatarStorageService);
    expect(module.get(UsersService)).toBeInstanceOf(UsersService);
    expect(module.get(UsersController)).toBeInstanceOf(UsersController);
  });
});
