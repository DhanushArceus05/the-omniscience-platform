import { Test, TestingModule } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import type Redis from "ioredis";
import { ConfigModule } from "../config/config.module";
import { ENV, LOGGER } from "../config/config.constants";
import { MailModule } from "../mail/mail.module";
import { MailService } from "../mail/mail.service";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { RedisModule } from "../redis/redis.module";
import { RedisService } from "../redis/redis.service";
import { AccessTokenService } from "./access-token.service";
import { AuthController } from "./auth.controller";
import { AuthModule } from "./auth.module";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { OtpService } from "./otp.service";
import { PasswordHasherService } from "./password-hasher.service";
import { PasswordResetStore } from "./password-reset.store";
import { PendingRegistrationStore } from "./pending-registration.store";
import { RefreshTokenStore } from "./refresh-token.store";

const testEnv = {
  OTP_TTL_SECONDS: 600,
  OTP_MAX_ATTEMPTS: 5,
  OTP_RESEND_COOLDOWN_SECONDS: 60,
  JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef",
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 604800,
} as unknown as Env;

describe("AuthModule", () => {
  it("compiles and provides every Step 3 + Step 4 + Step 5 provider plus AuthController", async () => {
    const module: TestingModule = await Test.createTestingModule({
      // ConfigModule/PrismaModule/RedisModule/MailModule are all
      // @Global(), but a Nest testing module only registers global
      // providers that are actually part of its own compiled graph —
      // they must be imported here even though AuthModule itself never
      // imports them directly (it relies on them being global in the
      // real AppModule).
      imports: [ConfigModule, PrismaModule, RedisModule, MailModule, AuthModule],
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
    expect(module.get(OtpService)).toBeInstanceOf(OtpService);
    expect(module.get(PendingRegistrationStore)).toBeInstanceOf(PendingRegistrationStore);
    expect(module.get(AccessTokenService)).toBeInstanceOf(AccessTokenService);
    expect(module.get(RefreshTokenStore)).toBeInstanceOf(RefreshTokenStore);
    expect(module.get(PasswordResetStore)).toBeInstanceOf(PasswordResetStore);
    expect(module.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    expect(module.get(AuthService)).toBeInstanceOf(AuthService);
    expect(module.get(AuthController)).toBeInstanceOf(AuthController);
  });
});
