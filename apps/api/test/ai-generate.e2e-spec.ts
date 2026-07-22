import * as path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Env } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ANTHROPIC_CLIENT } from "../src/ai/providers/anthropic-client.provider";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { ENV } from "../src/config/config.constants";
import { MailService } from "../src/mail/mail.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { registerVerifyAndLogin } from "./helpers/auth-test-helpers";
import { testEnv } from "./helpers/create-test-app";
import { FakeMailService } from "./helpers/fake-mail.service";
import { FakePrismaService } from "./helpers/fake-prisma.service";
import { FakeRedisService } from "./helpers/fake-redis.service";

/**
 * Exercises the real HTTP surface of `POST /ai/generate` (Phase 4
 * Step 3) — the real `JwtAuthGuard`, the real (never-overridden)
 * `ThrottlerGuard`, the real `ZodValidationPipe`/`generateTextRequestSchema`,
 * and the real `AiService` → `ModelSelectorService` →
 * `ProviderRegistryService` → `AnthropicProvider.generateText()` chain.
 *
 * No test in this file makes a live vendor network call: the
 * `ANTHROPIC_CLIENT` DI token is overridden with a fake object
 * implementing `AnthropicMessagesClient` (same technique
 * `anthropic.provider.spec.ts` uses at the unit level), so even the
 * "success" test never leaves the process.
 *
 * Each test gets its own fresh `INestApplication` — same reasoning as
 * `workspaces.e2e-spec.ts` — so per-route throttle counters never leak
 * between tests.
 */
describe("POST /ai/generate (e2e, Phase 4 Step 3)", () => {
  const password = "Sup3r$ecretPassw0rd!";

  interface FakeAnthropicClient {
    readonly messages: { readonly create: jest.Mock };
  }

  function makeFakeAnthropicClient(): FakeAnthropicClient {
    return { messages: { create: jest.fn() } };
  }

  /**
   * Builds a fresh app from the real `AppModule`, optionally with
   * `ANTHROPIC_API_KEY` configured and the `ANTHROPIC_CLIENT` token
   * overridden with a fake — everything else identical to
   * `helpers/create-test-app.ts`'s `createTestApp()`.
   */
  async function buildApp(options: {
    anthropicApiKey?: string;
    anthropicClient?: FakeAnthropicClient;
  }): Promise<{ app: INestApplication; mail: FakeMailService }> {
    const mail = new FakeMailService();
    const env: Env = {
      ...testEnv,
      ANTHROPIC_API_KEY: options.anthropicApiKey,
    } as Env;

    let builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(RedisService)
      .useValue(new FakeRedisService())
      .overrideProvider(PrismaService)
      .useValue(new FakePrismaService())
      .overrideProvider(MailService)
      .useValue(mail);

    if (options.anthropicClient) {
      builder = builder.overrideProvider(ANTHROPIC_CLIENT).useValue(options.anthropicClient);
    }

    const moduleFixture: TestingModule = await builder.compile();

    const app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useGlobalFilters(new AllExceptionsFilter(createLogger({ service: "api-test" })));
    app.useStaticAssets(path.resolve(testEnv.AVATAR_STORAGE_DIR), { prefix: "/uploads/avatars" });
    await app.init();

    return { app, mail };
  }

  it("rejects an unauthenticated request with 401", async () => {
    const { app } = await buildApp({});
    await request(app.getHttpServer())
      .post("/ai/generate")
      .send({ prompt: "hello" })
      .expect(401);
    await app.close();
  });

  it("rejects an empty prompt with a validation error", async () => {
    const { app, mail } = await buildApp({});
    const accessToken = await registerVerifyAndLogin(
      app,
      mail,
      "generate-empty@example.com",
      password,
      "Generator",
    );

    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ prompt: "   " })
      .expect(400);
    await app.close();
  });

  it("rejects a prompt over 8000 characters", async () => {
    const { app, mail } = await buildApp({});
    const accessToken = await registerVerifyAndLogin(
      app,
      mail,
      "generate-toolong@example.com",
      password,
      "Generator",
    );

    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ prompt: "a".repeat(8_001) })
      .expect(400);
    await app.close();
  });

  it("rejects a request that also sends internal routing fields", async () => {
    const { app, mail } = await buildApp({});
    const accessToken = await registerVerifyAndLogin(
      app,
      mail,
      "generate-routing-fields@example.com",
      password,
      "Generator",
    );

    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ prompt: "hello", preferredProviderId: "anthropic" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ prompt: "hello", preferredModelId: "claude-sonnet-5" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ prompt: "hello", requiredCapabilities: ["text-generation"] })
      .expect(400);

    await app.close();
  });

  it("returns NO_COMPATIBLE_MODEL (422) when no provider is configured", async () => {
    const { app, mail } = await buildApp({});
    const accessToken = await registerVerifyAndLogin(
      app,
      mail,
      "generate-unconfigured@example.com",
      password,
      "Generator",
    );

    const response = await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ prompt: "hello" })
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("NO_COMPATIBLE_MODEL");
    await app.close();
  });

  it("generates text through the full selector -> registry -> provider path and returns only text/providerId/modelId", async () => {
    const fakeClient = makeFakeAnthropicClient();
    fakeClient.messages.create.mockResolvedValue({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "Hello, world!", citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null,
      },
    });

    const { app, mail } = await buildApp({
      anthropicApiKey: "test-key",
      anthropicClient: fakeClient,
    });
    const accessToken = await registerVerifyAndLogin(
      app,
      mail,
      "generate-success@example.com",
      password,
      "Generator",
    );

    const response = await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ prompt: "Say hello" })
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        text: "Hello, world!",
        providerId: "anthropic",
        modelId: expect.any(String),
      },
    });
    expect(Object.keys(response.body.data).sort()).toEqual(["modelId", "providerId", "text"]);
    expect(fakeClient.messages.create).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("applies throttling to POST /ai/generate", async () => {
    const { app, mail } = await buildApp({});
    const accessToken = await registerVerifyAndLogin(
      app,
      mail,
      "generate-throttle@example.com",
      password,
      "Generator",
    );

    // The route's explicit @Throttle limit is 10 requests / 10 minutes.
    // Send one more than that and expect the last one to be rate-limited.
    for (let i = 0; i < 10; i += 1) {
      await request(app.getHttpServer())
        .post("/ai/generate")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ prompt: "hello" });
    }

    await request(app.getHttpServer())
      .post("/ai/generate")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ prompt: "hello" })
      .expect(429);

    await app.close();
  });
});
