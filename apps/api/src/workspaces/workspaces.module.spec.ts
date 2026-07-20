import { Test, TestingModule } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import type Redis from "ioredis";
import { AuthModule } from "../auth/auth.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AvatarModule } from "../avatar/avatar.module";
import { ENV, LOGGER } from "../config/config.constants";
import { ConfigModule } from "../config/config.module";
import { MailModule } from "../mail/mail.module";
import { MailService } from "../mail/mail.service";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { RedisModule } from "../redis/redis.module";
import { RedisService } from "../redis/redis.service";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesModule } from "./workspaces.module";
import { WorkspacesService } from "./workspaces.service";

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
} as unknown as Env;

describe("WorkspacesModule", () => {
  it("compiles and provides WorkspacesService, WorkspacesController, and AuthModule's JwtAuthGuard", async () => {
    const module: TestingModule = await Test.createTestingModule({
      // Same rationale as users.module.spec.ts: ConfigModule/PrismaModule/
      // RedisModule/MailModule/AvatarModule are all @Global(), but a Nest
      // testing module only registers global providers that are part of
      // its own compiled graph — AvatarModule must be imported here too,
      // since AuthModule's AuthService now depends on AvatarStorageService
      // (Phase 3 Step 3).
      imports: [
        ConfigModule,
        PrismaModule,
        RedisModule,
        MailModule,
        AvatarModule,
        AuthModule,
        WorkspacesModule,
      ],
    })
      .overrideProvider(ENV)
      .useValue(testEnv)
      .overrideProvider(LOGGER)
      .useValue(createLogger({ service: "api-test" }))
      .overrideProvider(PrismaService)
      .useValue({ workspace: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() } })
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
      .compile();

    expect(module.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    expect(module.get(WorkspacesService)).toBeInstanceOf(WorkspacesService);
    expect(module.get(WorkspacesController)).toBeInstanceOf(WorkspacesController);
  });
});
