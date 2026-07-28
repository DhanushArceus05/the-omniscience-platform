import { Test, TestingModule } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import type Redis from "ioredis";
import { AiModule } from "../ai/ai.module";
import { ProviderRegistryService } from "../ai/provider-registry.service";
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
import { ExecutionOrchestratorService } from "./execution-orchestrator.service";
import { OmniCoreController } from "./omnicore.controller";
import { OmniCoreModule } from "./omnicore.module";
import { OmniCoreService } from "./omnicore.service";
import { TaskPlannerService } from "./task-planner.service";

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
  // the "no credentials configured" path through real module bootstrap
  // — same rationale as ai.module.spec.ts.
} as unknown as Env;

describe("OmniCoreModule", () => {
  it("compiles, reuses AiModule's seeded registry, and provides AuthModule's JwtAuthGuard", async () => {
    const module: TestingModule = await Test.createTestingModule({
      // Same rationale as ai.module.spec.ts: @Global() modules still
      // need to be part of this test module's own compiled graph, and
      // AiModule must be imported directly (not just transitively)
      // since OmniCoreModule only re-exports nothing from it.
      imports: [
        ConfigModule,
        PrismaModule,
        RedisModule,
        MailModule,
        AvatarModule,
        AuthModule,
        AiModule,
        OmniCoreModule,
      ],
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
    expect(module.get(OmniCoreController)).toBeInstanceOf(OmniCoreController);
    expect(module.get(OmniCoreService)).toBeInstanceOf(OmniCoreService);
    expect(module.get(TaskPlannerService)).toBeInstanceOf(TaskPlannerService);
    expect(module.get(ExecutionOrchestratorService)).toBeInstanceOf(ExecutionOrchestratorService);

    // OmniCoreModule must not re-register any provider of its own —
    // the registry it resolves is the exact same singleton AiModule's
    // own AiProviderSeedService already seeded.
    const registry = module.get(ProviderRegistryService);
    const providerIds = registry.list().map((provider) => provider.providerId);
    expect(providerIds.sort()).toEqual(["anthropic", "gemini", "openai"]);

    await module.close();
  });
});
