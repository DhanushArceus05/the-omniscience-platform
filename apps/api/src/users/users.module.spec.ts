import { Test, TestingModule } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import type Redis from "ioredis";
import { AccessTokenService } from "../auth/access-token.service";
import { AuthModule } from "../auth/auth.module";
import { ENV, LOGGER } from "../config/config.constants";
import { ConfigModule } from "../config/config.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MailModule } from "../mail/mail.module";
import { MailService } from "../mail/mail.service";
import { PasswordHasherService } from "../auth/password-hasher.service";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { RedisModule } from "../redis/redis.module";
import { RedisService } from "../redis/redis.service";
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
} as unknown as Env;

describe("UsersModule", () => {
  it("compiles and provides UsersService, UsersController, and the JwtAuthGuard it depends on via AuthModule", async () => {
    const module: TestingModule = await Test.createTestingModule({
      // Same rationale as auth.module.spec.ts: ConfigModule/PrismaModule/
      // RedisModule/MailModule are all @Global(), but a Nest testing
      // module only registers global providers that are actually part
      // of its own compiled graph — they must be imported here even
      // though UsersModule/AuthModule never import them directly (they
      // rely on them being global in the real AppModule).
      imports: [ConfigModule, PrismaModule, RedisModule, MailModule, AuthModule, UsersModule],
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
      .compile();

    expect(module.get(PasswordHasherService)).toBeInstanceOf(PasswordHasherService);
    expect(module.get(AccessTokenService)).toBeInstanceOf(AccessTokenService);
    expect(module.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    expect(module.get(UsersService)).toBeInstanceOf(UsersService);
    expect(module.get(UsersController)).toBeInstanceOf(UsersController);
  });
});
