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
import { MongoService } from "../src/mongo/mongo.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { registerVerifyAndLogin } from "./helpers/auth-test-helpers";
import { testEnv } from "./helpers/create-test-app";
import { FakeMailService } from "./helpers/fake-mail.service";
import { FakeMongoService } from "./helpers/fake-mongo.service";
import { FakePrismaService } from "./helpers/fake-prisma.service";
import { FakeRedisService } from "./helpers/fake-redis.service";

/**
 * Exercises the real HTTP surface of Phase 6 Step 1 (Conversation &
 * Message Persistence Foundation): every route on
 * `ConversationsController`, backed by a fresh `FakeMongoService`
 * (`apps/api/test/helpers/fake-mongo.service.ts`) so no live MongoDB
 * instance is required, and — for the "real OmniCore integration"
 * tests — a fake `ANTHROPIC_CLIENT`, same technique
 * `ai-generate.e2e-spec.ts` already established, so `POST
 * .../messages`'s call into the real, unmodified `OmniCoreService.execute()`
 * → `ModelSelectorService` → `ProviderRegistryService` →
 * `AnthropicProvider.generateText()` chain never leaves the process.
 *
 * Each test gets its own fresh `INestApplication` — same reasoning as
 * `workspaces.e2e-spec.ts` — so per-route throttle counters and each
 * test's `FakeMongoService` instance never leak between tests.
 */
describe("Conversations & Messages (e2e, Phase 6 Step 1)", () => {
  const password = "Sup3r$ecretPassw0rd!";

  interface FakeAnthropicClient {
    readonly messages: { readonly create: jest.Mock };
  }

  function makeFakeAnthropicClient(): FakeAnthropicClient {
    return { messages: { create: jest.fn() } };
  }

  function successfulAnthropicResponse(text: string) {
    return {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "text", text, citations: null }],
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
    };
  }

  /**
   * Builds a fresh app from the real `AppModule`, optionally with
   * `ANTHROPIC_API_KEY` configured and `ANTHROPIC_CLIENT` overridden
   * with a fake — everything else identical to
   * `helpers/create-test-app.ts`'s `createTestApp()`, reimplemented
   * locally (same pattern `ai-generate.e2e-spec.ts` uses) because this
   * suite needs the extra `ANTHROPIC_API_KEY`/`ANTHROPIC_CLIENT`
   * overrides `createTestApp()` doesn't take.
   */
  async function buildApp(options: {
    anthropicApiKey?: string;
    anthropicClient?: FakeAnthropicClient;
  }): Promise<{ app: INestApplication; mail: FakeMailService }> {
    const mail = new FakeMailService();
    const env: Env = { ...testEnv, ANTHROPIC_API_KEY: options.anthropicApiKey } as Env;

    let builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(RedisService)
      .useValue(new FakeRedisService())
      .overrideProvider(MongoService)
      .useValue(new FakeMongoService())
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
    app.useStaticAssets(path.resolve(testEnv.AVATAR_STORAGE_DIR), {
      prefix: "/uploads/avatars",
      etag: false,
      lastModified: false,
      cacheControl: false,
    });
    await app.init();

    return { app, mail };
  }

  async function createWorkspace(app: INestApplication, accessToken: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/workspaces")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Research" })
      .expect(201);
    return response.body.data.id as string;
  }

  describe("POST /workspaces/:workspaceId/conversations", () => {
    it("creates a conversation with a null title, owned by the caller", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "create@example.com", password, "Creator");
      const workspaceId = await createWorkspace(app, accessToken);

      const response = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      expect(response.body).toEqual({
        success: true,
        data: {
          id: expect.any(String),
          workspaceId,
          title: null,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });
      await app.close();
    });

    it("returns WORKSPACE_NOT_FOUND for a workspace the caller doesn't own", async () => {
      const { app, mail } = await buildApp({});
      const ownerToken = await registerVerifyAndLogin(app, mail, "owner@example.com", password, "Owner");
      const workspaceId = await createWorkspace(app, ownerToken);
      const otherToken = await registerVerifyAndLogin(app, mail, "other@example.com", password, "Other");

      const response = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${otherToken}`)
        .send({})
        .expect(404);

      expect(response.body.error.code).toBe("WORKSPACE_NOT_FOUND");
      await app.close();
    });

    it("rejects a title field with a validation error (title is not accepted this step)", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "title@example.com", password, "Creator");
      const workspaceId = await createWorkspace(app, accessToken);

      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ title: "My conversation" })
        .expect(400);
      await app.close();
    });

    it("rejects an unauthenticated request", async () => {
      const { app } = await buildApp({});
      await request(app.getHttpServer()).post("/workspaces/any-workspace/conversations").send({}).expect(401);
      await app.close();
    });
  });

  describe("GET /workspaces/:workspaceId/conversations and /:conversationId", () => {
    it("lists only the caller's own conversations, newest first, and reloads one by id", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "list@example.com", password, "Lister");
      const workspaceId = await createWorkspace(app, accessToken);

      const first = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      const listResponse = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(listResponse.body.data.conversations.map((c: { id: string }) => c.id)).toEqual([
        second.body.data.id,
        first.body.data.id,
      ]);

      const getResponse = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${first.body.data.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(getResponse.body.data.id).toBe(first.body.data.id);

      await app.close();
    });

    it("paginates with a bounded limit and a usable nextCursor", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "paginate@example.com", password, "Paginator");
      const workspaceId = await createWorkspace(app, accessToken);

      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await request(app.getHttpServer())
          .post(`/workspaces/${workspaceId}/conversations`)
          .set("Authorization", `Bearer ${accessToken}`)
          .send({})
          .expect(201);
      }

      const firstPage = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations?limit=2`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(firstPage.body.data.conversations).toHaveLength(2);
      expect(firstPage.body.data.nextCursor).not.toBeNull();

      const secondPage = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations?limit=2&cursor=${firstPage.body.data.nextCursor}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(secondPage.body.data.conversations).toHaveLength(1);

      await app.close();
    });

    it("returns CONVERSATION_NOT_FOUND identically for a nonexistent id and another owner's id", async () => {
      const { app, mail } = await buildApp({});
      const ownerToken = await registerVerifyAndLogin(app, mail, "convowner@example.com", password, "Owner");
      const workspaceId = await createWorkspace(app, ownerToken);
      const created = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({})
        .expect(201);
      const otherToken = await registerVerifyAndLogin(app, mail, "convoother@example.com", password, "Other");
      const otherWorkspaceId = await createWorkspace(app, otherToken);

      const nonexistentId = "665f1c2b9a4e8f0012345678";
      const nonexistentResponse = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${nonexistentId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(404);

      const foreignResponse = await request(app.getHttpServer())
        .get(`/workspaces/${otherWorkspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${otherToken}`)
        .expect(404);

      expect(nonexistentResponse.body.error).toEqual(foreignResponse.body.error);
      expect(nonexistentResponse.body.error.code).toBe("CONVERSATION_NOT_FOUND");

      await app.close();
    });

    it("rejects a malformed conversation id (not a valid ObjectId) with a validation error", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "badid@example.com", password, "Tester");
      const workspaceId = await createWorkspace(app, accessToken);

      const response = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/not-a-valid-object-id`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");

      await app.close();
    });

    it("returns CONVERSATION_NOT_FOUND when the same owner requests it through a different one of their own workspaces", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "crossworkspace@example.com", password, "Owner");
      const workspaceA = await createWorkspace(app, accessToken);
      const workspaceB = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceA}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceB}/conversations/${conversation.body.data.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404);

      expect(response.body.error.code).toBe("CONVERSATION_NOT_FOUND");

      await app.close();
    });
  });

  describe("POST /workspaces/:workspaceId/conversations/:conversationId/messages", () => {
    it("routes a message through the real OmniCore pipeline, persists both messages, and reloads them in chronological order", async () => {
      const fakeClient = makeFakeAnthropicClient();
      fakeClient.messages.create.mockResolvedValue(successfulAnthropicResponse("Hello! How can I help?"));

      const { app, mail } = await buildApp({ anthropicApiKey: "test-key", anthropicClient: fakeClient });
      const accessToken = await registerVerifyAndLogin(app, mail, "chat@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      const conversationId = conversation.body.data.id as string;

      const sendResponse = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "Say hello" })
        .expect(201);

      expect(sendResponse.body.success).toBe(true);
      expect(sendResponse.body.data.userMessage).toMatchObject({ role: "user", content: "Say hello" });
      expect(sendResponse.body.data.assistantMessage).toMatchObject({
        role: "assistant",
        content: "Hello! How can I help?",
      });
      expect(sendResponse.body.data.assistantMessage.omniCore).toEqual({
        planId: expect.any(String),
        intent: expect.any(String),
        matchedRuleId: expect.any(String),
        confidence: expect.any(Number),
        providerId: "anthropic",
        modelId: expect.any(String),
        taskPlanId: expect.any(String),
      });
      expect(fakeClient.messages.create).toHaveBeenCalledTimes(1);

      const reload = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(reload.body.data.messages.map((m: { role: string }) => m.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(reload.body.data.messages[0].content).toBe("Say hello");
      expect(reload.body.data.messages[1].content).toBe("Hello! How can I help?");
      expect(reload.body.data.nextCursor).toBeNull();

      await app.close();
    });

    it("paginates messages chronologically with a bounded limit and a usable nextCursor", async () => {
      const fakeClient = makeFakeAnthropicClient();
      fakeClient.messages.create.mockResolvedValue(successfulAnthropicResponse("ok"));

      const { app, mail } = await buildApp({ anthropicApiKey: "test-key", anthropicClient: fakeClient });
      const accessToken = await registerVerifyAndLogin(app, mail, "paginatemsg@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      const conversationId = conversation.body.data.id as string;

      for (let i = 0; i < 2; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await request(app.getHttpServer())
          .post(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
          .set("Authorization", `Bearer ${accessToken}`)
          .send({ content: `message ${i}` })
          .expect(201);
      }
      // Each send produces 2 messages (user + assistant), so 4 total exist.

      const firstPage = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${conversationId}/messages?limit=2`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(firstPage.body.data.messages).toHaveLength(2);
      expect(firstPage.body.data.nextCursor).not.toBeNull();

      const secondPage = await request(app.getHttpServer())
        .get(
          `/workspaces/${workspaceId}/conversations/${conversationId}/messages?limit=2&cursor=${firstPage.body.data.nextCursor}`,
        )
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(secondPage.body.data.messages).toHaveLength(2);
      expect(secondPage.body.data.nextCursor).toBeNull();

      await app.close();
    });

    it("propagates NO_COMPATIBLE_MODEL (422) unchanged when no provider is configured, and keeps the user message persisted", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "nofallback@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      const conversationId = conversation.body.data.id as string;

      const sendResponse = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "Say hello" })
        .expect(422);

      expect(sendResponse.body.success).toBe(false);
      expect(sendResponse.body.error.code).toBe("NO_COMPATIBLE_MODEL");

      // The user message must still be persisted and reachable, even
      // though OmniCore execution failed — no assistant message exists.
      const reload = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(reload.body.data.messages).toHaveLength(1);
      expect(reload.body.data.messages[0]).toMatchObject({ role: "user", content: "Say hello" });

      await app.close();
    });

    it("returns CONVERSATION_NOT_FOUND for another owner's conversation and never persists a message", async () => {
      const { app, mail } = await buildApp({});
      const ownerToken = await registerVerifyAndLogin(app, mail, "msgowner@example.com", password, "Owner");
      const workspaceId = await createWorkspace(app, ownerToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({})
        .expect(201);
      const conversationId = conversation.body.data.id as string;
      const otherToken = await registerVerifyAndLogin(app, mail, "msgother@example.com", password, "Other");

      const response = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ content: "Say hello" })
        .expect(404);

      expect(response.body.error.code).toBe("CONVERSATION_NOT_FOUND");

      await app.close();
    });

    it("rejects a message with no content", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "emptymsg@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversation.body.data.id}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "   " })
        .expect(400);

      await app.close();
    });

    it("rejects content over 8000 characters, the same limit POST /omnicore/execute enforces", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "toolongmsg@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversation.body.data.id}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "a".repeat(8_001) })
        .expect(400);

      await app.close();
    });

    it("rejects an unauthenticated request", async () => {
      const { app } = await buildApp({});
      await request(app.getHttpServer())
        .post("/workspaces/any-workspace/conversations/665f1c2b9a4e8f0012345678/messages")
        .send({ content: "hello" })
        .expect(401);
      await app.close();
    });
  });
});
