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
import { AiController } from "./ai.controller";
import { AiModule } from "./ai.module";
import { ModelCatalogService } from "./model-catalog.service";
import { ModelSelectorService } from "./model-selector.service";
import { ProviderRegistryService } from "./provider-registry.service";

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
  // Deliberately every provider key unset, so this test also exercises
  // the "no credentials configured" path through real module bootstrap.
} as unknown as Env;

describe("AiModule", () => {
  it("compiles, seeds the registry/catalog, and provides AuthModule's JwtAuthGuard", async () => {
    const module: TestingModule = await Test.createTestingModule({
      // Same rationale as workspaces.module.spec.ts: @Global() modules
      // still need to be part of this test module's own compiled graph.
      imports: [ConfigModule, PrismaModule, RedisModule, MailModule, AvatarModule, AuthModule, AiModule],
    })
      .overrideProvider(ENV)
      .useValue(testEnv)
      .overrideProvider(LOGGER)
      .useValue(createLogger({ service: "api-test" }))
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(RedisService)
      .useValue({
        getClient: () =>
          ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), eval: jest.fn() }) as unknown as Redis,
      })
      .overrideProvider(MailService)
      .useValue({ sendMail: jest.fn(), isConfigured: () => false })
      .compile();

    await module.init();

    expect(module.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    expect(module.get(AiController)).toBeInstanceOf(AiController);

    const registry = module.get(ProviderRegistryService);
    const catalog = module.get(ModelCatalogService);
    expect(module.get(ModelSelectorService)).toBeInstanceOf(ModelSelectorService);

    const providerIds = registry.list().map((provider) => provider.providerId);
    expect(providerIds.sort()).toEqual(["anthropic", "gemini", "openai"]);
    expect(catalog.list().length).toBeGreaterThan(0);
    registry.list().forEach((provider) => expect(provider.configStatus()).toBe("not-configured"));

    await module.close();
  });
});
