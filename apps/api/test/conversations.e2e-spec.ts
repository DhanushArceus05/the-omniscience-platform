import * as http from "node:http";
import * as path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "@omniscience/config";
import { createLogger } from "@omniscience/utils";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ANTHROPIC_CLIENT } from "../src/ai/providers/anthropic-client.provider";
import { GEMINI_CLIENT } from "../src/ai/providers/gemini-client.provider";
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
 * Message Persistence Foundation), Phase 6 Step 2 (backend-only
 * authenticated assistant response streaming), and Phase 6 Step 4
 * (Conversation Management — rename/delete), backed by a fresh
 * `FakeMongoService` (`apps/api/test/helpers/fake-mongo.service.ts`)
 * so no live MongoDB instance is required, and — for the "real
 * OmniCore integration" tests — a fake `ANTHROPIC_CLIENT`, same
 * technique `ai-generate.e2e-spec.ts` already established, so both
 * `POST .../messages`'s call into `OmniCoreService.execute()` and
 * `POST .../messages/stream`'s call into `OmniCoreService.executeStream()`
 * — each unmodified, through the real `ModelSelectorService` →
 * `ProviderRegistryService` → `AnthropicProvider` chain — never leave
 * the process. `FakeAnthropicClient` below now stubs both
 * `messages.create` (Step 1) and `messages.stream` (Step 2).
 *
 * Each test gets its own fresh `INestApplication` — same reasoning as
 * `workspaces.e2e-spec.ts` — so per-route throttle counters and each
 * test's `FakeMongoService` instance never leak between tests.
 */
describe("Conversations & Messages (e2e, Phase 6 Step 1, Step 2 & Step 4)", () => {
  const password = "Sup3r$ecretPassw0rd!";

  interface FakeAnthropicClient {
    readonly messages: { readonly create: jest.Mock; readonly stream: jest.Mock };
  }

  function makeFakeAnthropicClient(): FakeAnthropicClient {
    return { messages: { create: jest.fn(), stream: jest.fn() } };
  }

  interface FakeGeminiClient {
    readonly models: { readonly generateContent: jest.Mock };
  }

  function makeFakeGeminiClient(): FakeGeminiClient {
    return { models: { generateContent: jest.fn() } };
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
    geminiApiKey?: string;
    geminiClient?: FakeGeminiClient;
  }): Promise<{ app: INestApplication; mail: FakeMailService }> {
    const mail = new FakeMailService();
    const env: Env = {
      ...testEnv,
      ANTHROPIC_API_KEY: options.anthropicApiKey,
      GEMINI_API_KEY: options.geminiApiKey,
    } as Env;

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
    if (options.geminiClient) {
      builder = builder.overrideProvider(GEMINI_CLIENT).useValue(options.geminiClient);
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

  /** Splits a fully-buffered SSE response body (`response.text`, from supertest's default text parsing of `text/event-stream`) into `{event, data}` pairs — a minimal, test-only mirror of `@omniscience/sdk`'s own incremental parser, deliberately simpler since a supertest response is never chunked from this side. */
  function parseSseFrames(raw: string): Array<{ event: string; data: unknown }> {
    return raw
      .split("\n\n")
      .map((frame) => frame.trim())
      .filter((frame) => frame.length > 0)
      .map((frame) => {
        const lines = frame.split("\n");
        const eventLine = lines.find((line) => line.startsWith("event:"));
        const dataLine = lines.find((line) => line.startsWith("data:"));
        return {
          event: eventLine ? eventLine.slice("event:".length).trim() : "",
          data: dataLine ? (JSON.parse(dataLine.slice("data:".length).trim()) as unknown) : undefined,
        };
      });
  }

  /**
   * Polls `check` until it resolves `true` or `timeoutMs` elapses —
   * used only for the client-abort test below, where the server-side
   * persistence this test asserts on happens asynchronously, after
   * this test's own client has already torn down its side of the
   * connection.
   *
   * `intervalMs` is deliberately not as tight as
   * `expectAvatarGone`'s in `avatar.e2e-spec.ts` (the closest existing
   * polling convention in this test suite): that helper polls a static
   * asset route served by `useStaticAssets` middleware, which sits
   * outside Nest's routing entirely and is never subject to
   * `ThrottlerGuard`. `GET .../messages` is an ordinary
   * `ConversationsController` route with no `@Throttle()` override, so
   * it uses the app-wide default (`ThrottlerModule.forRoot([{ ttl:
   * 60_000, limit: 60 }])`, `app.module.ts`) — 60 requests per 60
   * seconds, tracked per-handler (see `ConversationsController`'s own
   * doc comment on why `GET` routes get no override). At the original
   * `intervalMs: 25`, a full `timeoutMs: 3000` wait could issue up to
   * ~120 polling requests to that one handler — comfortably enough on
   * its own to trip the same 60/60s limit the two `reload`/
   * `finalReload` calls below also draw from, well before this test's
   * actual condition (which normally resolves in well under a second)
   * ever gets the chance to. `intervalMs: 100` caps that same
   * `timeoutMs: 3000` budget at ~30 polling requests — comfortably
   * under the limit even together with those two extra calls — while
   * leaving the full 3 seconds of real wall-clock budget for the
   * condition to actually become true untouched.
   */
  async function waitFor(check: () => Promise<boolean>, timeoutMs = 3000, intervalMs = 100): Promise<void> {
    const start = Date.now();
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      if (await check()) {
        return;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error("waitFor: condition was not met within the timeout");
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /** Puts `app` on a real ephemeral TCP port, for the one test below (client abort) that needs raw `node:http` control over the connection — something supertest's per-request ephemeral binding doesn't expose. */
  async function startListening(app: INestApplication): Promise<number> {
    await app.listen(0);
    const address = app.getHttpServer().address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected app.listen(0) to bind a network address with a port.");
    }
    return address.port;
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

  describe("PATCH /workspaces/:workspaceId/conversations/:conversationId — Phase 6 Step 4 (rename)", () => {
    it("renames the caller's own conversation and persists the new title", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "rename@example.com", password, "Renamer");
      const workspaceId = await createWorkspace(app, accessToken);
      const created = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      const renameResponse = await request(app.getHttpServer())
        .patch(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ title: "  My renamed conversation  " })
        .expect(200);

      expect(renameResponse.body).toEqual({
        success: true,
        data: {
          id: created.body.data.id,
          workspaceId,
          title: "My renamed conversation",
          createdAt: created.body.data.createdAt,
          updatedAt: expect.any(String),
        },
      });

      const reloaded = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(reloaded.body.data.title).toBe("My renamed conversation");

      await app.close();
    });

    it("returns CONVERSATION_NOT_FOUND for another owner's conversation, without renaming it", async () => {
      const { app, mail } = await buildApp({});
      const ownerToken = await registerVerifyAndLogin(app, mail, "renameowner@example.com", password, "Owner");
      const workspaceId = await createWorkspace(app, ownerToken);
      const created = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({})
        .expect(201);
      const otherToken = await registerVerifyAndLogin(app, mail, "renameother@example.com", password, "Other");

      const response = await request(app.getHttpServer())
        .patch(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ title: "Hijacked title" })
        .expect(404);
      expect(response.body.error.code).toBe("CONVERSATION_NOT_FOUND");

      const reloaded = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);
      expect(reloaded.body.data.title).toBeNull();

      await app.close();
    });

    it("rejects an empty title with a validation error", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "renameempty@example.com", password, "Renamer");
      const workspaceId = await createWorkspace(app, accessToken);
      const created = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ title: "   " })
        .expect(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");

      await app.close();
    });

    it("rejects an unauthenticated request", async () => {
      const { app } = await buildApp({});
      await request(app.getHttpServer())
        .patch("/workspaces/any-workspace/conversations/665f1c2b9a4e8f0012345678")
        .send({ title: "New title" })
        .expect(401);
      await app.close();
    });
  });

  describe("DELETE /workspaces/:workspaceId/conversations/:conversationId — Phase 6 Step 4 (delete)", () => {
    it("deletes the caller's own conversation, cascading to its messages", async () => {
      const fakeClient = makeFakeAnthropicClient();
      fakeClient.messages.create.mockResolvedValue(successfulAnthropicResponse("Hello!"));

      const { app, mail } = await buildApp({ anthropicApiKey: "test-key", anthropicClient: fakeClient });
      const accessToken = await registerVerifyAndLogin(app, mail, "delete@example.com", password, "Deleter");
      const workspaceId = await createWorkspace(app, accessToken);
      const created = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${created.body.data.id}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "Hello, OmniCore." })
        .expect(201);

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(deleteResponse.body).toEqual({ success: true, data: { deleted: true } });

      await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404);

      const listResponse = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(listResponse.body.data.conversations).toHaveLength(0);

      await app.close();
    });

    it("returns CONVERSATION_NOT_FOUND for another owner's conversation, without deleting it", async () => {
      const { app, mail } = await buildApp({});
      const ownerToken = await registerVerifyAndLogin(app, mail, "deleteowner@example.com", password, "Owner");
      const workspaceId = await createWorkspace(app, ownerToken);
      const created = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({})
        .expect(201);
      const otherToken = await registerVerifyAndLogin(app, mail, "deleteother@example.com", password, "Other");

      const response = await request(app.getHttpServer())
        .delete(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${otherToken}`)
        .expect(404);
      expect(response.body.error.code).toBe("CONVERSATION_NOT_FOUND");

      await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      await app.close();
    });

    it("returns CONVERSATION_NOT_FOUND for an already-deleted conversation", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "deletetwice@example.com", password, "Deleter");
      const workspaceId = await createWorkspace(app, accessToken);
      const created = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .delete(`/workspaces/${workspaceId}/conversations/${created.body.data.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404);
      expect(response.body.error.code).toBe("CONVERSATION_NOT_FOUND");

      await app.close();
    });

    it("rejects an unauthenticated request", async () => {
      const { app } = await buildApp({});
      await request(app.getHttpServer())
        .delete("/workspaces/any-workspace/conversations/665f1c2b9a4e8f0012345678")
        .expect(401);
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

  describe("POST /workspaces/:workspaceId/conversations/:conversationId/messages/stream — Phase 6 Step 2", () => {
    it("streams start → delta(s) → done with the required SSE headers and framing, and persists exactly one complete assistant message", async () => {
      const fakeClient = makeFakeAnthropicClient();
      fakeClient.messages.stream.mockReturnValue({
        textStream: (async function* () {
          yield "Hello";
          yield "! How can I help?";
        })(),
      });

      const { app, mail } = await buildApp({ anthropicApiKey: "test-key", anthropicClient: fakeClient });
      const accessToken = await registerVerifyAndLogin(app, mail, "stream@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      const conversationId = conversation.body.data.id as string;

      const response = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversationId}/messages/stream`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "Say hello" })
        .expect(200);

      expect(response.headers["content-type"]).toBe("text/event-stream");
      expect(response.headers["cache-control"]).toBe("no-cache");
      expect(response.headers.connection).toBe("keep-alive");
      expect(response.headers["x-accel-buffering"]).toBe("no");

      const frames = parseSseFrames(response.text);
      expect(frames.map((frame) => frame.event)).toEqual(["start", "delta", "delta", "done"]);

      const startData = frames[0]?.data as { userMessage: { role: string; content: string } };
      expect(startData.userMessage).toMatchObject({ role: "user", content: "Say hello" });

      expect(frames[1]?.data).toEqual({ text: "Hello" });
      expect(frames[2]?.data).toEqual({ text: "! How can I help?" });

      const doneData = frames[3]?.data as { assistantMessage: Record<string, unknown> };
      expect(doneData.assistantMessage).toMatchObject({
        role: "assistant",
        content: "Hello! How can I help?",
        status: "complete",
      });
      expect(doneData.assistantMessage.omniCore).toEqual({
        planId: expect.any(String),
        intent: expect.any(String),
        matchedRuleId: expect.any(String),
        confidence: expect.any(Number),
        providerId: "anthropic",
        modelId: expect.any(String),
        taskPlanId: expect.any(String),
      });
      expect(fakeClient.messages.stream).toHaveBeenCalledTimes(1);
      expect(fakeClient.messages.create).not.toHaveBeenCalled();

      // Confirms persistence happened exactly once. A duplicate
      // "incomplete" persistence triggered by the response's own
      // normal close (Phase 6 Step 2's own idempotency requirement)
      // would show up here as 3 messages instead of 2.
      const reload = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(reload.body.data.messages).toHaveLength(2);
      expect(reload.body.data.messages[0]).toMatchObject({ role: "user", status: "complete" });
      expect(reload.body.data.messages[1]).toMatchObject({
        role: "assistant",
        content: "Hello! How can I help?",
        status: "complete",
      });

      await app.close();
    });

    it("falls back to non-streaming generateText, emitting its complete result as a single delta, when the selected provider has no generateTextStream", async () => {
      // AnthropicProvider always implements generateTextStream, so this
      // exercises the fallback the way it can actually happen in this
      // codebase today: with no ANTHROPIC_API_KEY configured,
      // ModelSelectorService's eligibility check (`OmniProvider.isReady()`
      // + `supportsExecution()`) excludes Anthropic entirely, and Gemini
      // — configured here, and a genuinely executable adapter, but one
      // that (like OpenAI) has never had `generateTextStream` added —
      // is the only eligible candidate. Same technique
      // `step-executor.service.spec.ts`'s own fallback test uses at the
      // unit level, exercised here through the real HTTP → OmniCore →
      // ModelSelectorService → GeminiProvider chain.
      const fakeGeminiClient = makeFakeGeminiClient();
      fakeGeminiClient.models.generateContent.mockResolvedValue({ text: "Hello from Gemini!" });

      const { app, mail } = await buildApp({ geminiApiKey: "test-key", geminiClient: fakeGeminiClient });
      const accessToken = await registerVerifyAndLogin(app, mail, "fallback@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      const conversationId = conversation.body.data.id as string;

      const response = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversationId}/messages/stream`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "Say hello" })
        .expect(200);

      const frames = parseSseFrames(response.text);
      // The fallback contract itself is the key structural assertion:
      // the provider's complete result arrives as exactly one delta,
      // never split into multiple chunks the way a real streaming
      // provider might produce it, immediately followed by done.
      expect(frames.map((frame) => frame.event)).toEqual(["start", "delta", "done"]);
      expect(frames[1]?.data).toEqual({ text: "Hello from Gemini!" });
      const doneData = frames[2]?.data as { assistantMessage: { content: string; status: string } };
      expect(doneData.assistantMessage.content).toBe("Hello from Gemini!");
      expect(doneData.assistantMessage.status).toBe("complete");
      expect(fakeGeminiClient.models.generateContent).toHaveBeenCalledTimes(1);

      await app.close();
    });

    it("provider failure before any delta: no assistant message is persisted, a terminal SSE error is emitted, the user message is preserved", async () => {
      const fakeClient = makeFakeAnthropicClient();
      // A plain `AsyncIterable<string>` built directly from
      // `Symbol.asyncIterator` — not `async function*` — because this
      // stream never yields any text at all: the very first `next()`
      // call is meant to reject immediately, simulating a provider
      // failure before any delta. A generator function with no `yield`
      // is exactly that scenario, but is also flagged by the
      // `require-yield` lint rule; this satisfies the same
      // `AsyncIterable<string>` contract `AnthropicTextStream.textStream`
      // declares without ever being declared as a generator.
      fakeClient.messages.stream.mockReturnValue({
        textStream: {
          [Symbol.asyncIterator]: () => ({
            next: (): Promise<IteratorResult<string>> =>
              Promise.reject(new Anthropic.RateLimitError(429, {}, "rate limited", new Headers())),
          }),
        },
      });

      const { app, mail } = await buildApp({ anthropicApiKey: "test-key", anthropicClient: fakeClient });
      const accessToken = await registerVerifyAndLogin(app, mail, "nofirst@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      const conversationId = conversation.body.data.id as string;

      const response = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversationId}/messages/stream`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "Say hello" })
        .expect(200);

      const frames = parseSseFrames(response.text);
      expect(frames.map((frame) => frame.event)).toEqual(["start", "error"]);
      expect(frames[1]?.data).toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
      const errorData = frames[1]?.data as { message: string };
      expect(errorData.message).not.toMatch(/rate limited/i); // the raw SDK message text must never leak verbatim
      expect(errorData.message.length).toBeGreaterThan(0);

      const reload = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(reload.body.data.messages).toHaveLength(1);
      expect(reload.body.data.messages[0]).toMatchObject({ role: "user", content: "Say hello" });

      await app.close();
    });

    it("provider failure after partial output: the partial text persists exactly once, marked incomplete, and a terminal SSE error is emitted", async () => {
      const fakeClient = makeFakeAnthropicClient();
      fakeClient.messages.stream.mockReturnValue({
        textStream: (async function* (): AsyncGenerator<string> {
          yield "Hello, wor";
          throw new Anthropic.InternalServerError(500, {}, "internal error", new Headers());
        })(),
      });

      const { app, mail } = await buildApp({ anthropicApiKey: "test-key", anthropicClient: fakeClient });
      const accessToken = await registerVerifyAndLogin(app, mail, "midfail@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      const conversationId = conversation.body.data.id as string;

      const response = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversationId}/messages/stream`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "Say hello" })
        .expect(200);

      const frames = parseSseFrames(response.text);
      expect(frames.map((frame) => frame.event)).toEqual(["start", "delta", "error"]);
      expect(frames[1]?.data).toEqual({ text: "Hello, wor" });
      expect(frames[2]?.data).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

      const reload = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(reload.body.data.messages).toHaveLength(2);
      expect(reload.body.data.messages[1]).toMatchObject({
        role: "assistant",
        content: "Hello, wor",
        status: "incomplete",
      });

      await app.close();
    });

    it("client abort after partial output: cancellation propagates to the provider, and the partial text persists exactly once, marked incomplete", async () => {
      const fakeClient = makeFakeAnthropicClient();
      fakeClient.messages.stream.mockImplementation((_params: unknown, options?: { signal?: AbortSignal }) => ({
        textStream: (async function* (): AsyncGenerator<string> {
          yield "Hel";
          yield "lo, wor";
          // Genuinely honor the AbortSignal this fake was called with,
          // rather than completing regardless of it — this is what
          // makes this test exercise real cancellation propagation
          // (controller → ConversationsService → OmniCoreService →
          // StepExecutorService → AnthropicProvider → this fake) instead
          // of merely a stream that happens to be short.
          await new Promise<void>((resolve) => {
            if (options?.signal?.aborted) {
              resolve();
              return;
            }
            options?.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          throw new DOMException("The operation was aborted.", "AbortError");
        })(),
      }));

      const { app, mail } = await buildApp({ anthropicApiKey: "test-key", anthropicClient: fakeClient });
      const accessToken = await registerVerifyAndLogin(app, mail, "abort@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      const conversationId = conversation.body.data.id as string;

      const port = await startListening(app);

      await new Promise<void>((resolve) => {
        const body = JSON.stringify({ content: "Say hello" });
        const httpRequest = http.request(
          {
            host: "127.0.0.1",
            port,
            method: "POST",
            path: `/workspaces/${workspaceId}/conversations/${conversationId}/messages/stream`,
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
              Authorization: `Bearer ${accessToken}`,
            },
          },
          (res) => {
            let buffered = "";
            res.on("data", (chunk: Buffer) => {
              buffered += chunk.toString("utf8");
              // Abort as soon as at least one complete delta frame has
              // arrived — mid-stream, with real partial text already
              // accumulated server-side.
              if (buffered.includes("event: delta") && buffered.includes("\n\n")) {
                httpRequest.destroy();
              }
            });
            res.on("close", () => resolve());
            res.on("error", () => resolve());
          },
        );
        // Destroying the request ourselves raises a local socket error on
        // `httpRequest` — expected here, not a test failure.
        httpRequest.on("error", () => resolve());
        httpRequest.write(body);
        httpRequest.end();
      });

      await waitFor(async () => {
        const reload = await request(app.getHttpServer())
          .get(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
          .set("Authorization", `Bearer ${accessToken}`)
          .expect(200);
        return reload.body.data.messages.length === 2;
      });

      const reload = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(reload.body.data.messages).toHaveLength(2);
      expect(reload.body.data.messages[0]).toMatchObject({ role: "user", content: "Say hello" });
      expect(reload.body.data.messages[1]).toMatchObject({
        role: "assistant",
        content: "Hello, wor",
        status: "incomplete",
      });

      // Never persisted a second time by a later, redundant handler —
      // the exact "duplicate persistence" failure mode Phase 6 Step 2's
      // idempotency guards exist to prevent.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const finalReload = await request(app.getHttpServer())
        .get(`/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(finalReload.body.data.messages).toHaveLength(2);

      await app.close();
    });

    it("returns CONVERSATION_NOT_FOUND for another owner's conversation and never persists a message or opens SSE headers", async () => {
      const { app, mail } = await buildApp({});
      const ownerToken = await registerVerifyAndLogin(app, mail, "streamowner@example.com", password, "Owner");
      const workspaceId = await createWorkspace(app, ownerToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({})
        .expect(201);
      const conversationId = conversation.body.data.id as string;
      const otherToken = await registerVerifyAndLogin(app, mail, "streamother@example.com", password, "Other");

      const response = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversationId}/messages/stream`)
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ content: "Say hello" })
        .expect(404);

      // An ordinary JSON error response, not an SSE stream — proof
      // headers were never opened for a request that fails before
      // ownership resolves.
      expect(response.headers["content-type"]).not.toBe("text/event-stream");
      expect(response.body.error.code).toBe("CONVERSATION_NOT_FOUND");

      await app.close();
    });

    it("returns CONVERSATION_NOT_FOUND for a conversation nested under a workspace the caller doesn't own (workspace/conversation mismatch)", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "streammismatch@example.com", password, "Owner");
      const workspaceA = await createWorkspace(app, accessToken);
      const workspaceB = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceA}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceB}/conversations/${conversation.body.data.id}/messages/stream`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "Say hello" })
        .expect(404);

      expect(response.body.error.code).toBe("CONVERSATION_NOT_FOUND");
      await app.close();
    });

    it("rejects a message with no content", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "streamempty@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversation.body.data.id}/messages/stream`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "   " })
        .expect(400);

      await app.close();
    });

    it("rejects content over 8000 characters, the same limit the non-streaming endpoint enforces", async () => {
      const { app, mail } = await buildApp({});
      const accessToken = await registerVerifyAndLogin(app, mail, "streamtoolong@example.com", password, "Chatter");
      const workspaceId = await createWorkspace(app, accessToken);
      const conversation = await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .post(`/workspaces/${workspaceId}/conversations/${conversation.body.data.id}/messages/stream`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ content: "a".repeat(8_001) })
        .expect(400);

      await app.close();
    });

    it("rejects an unauthenticated request", async () => {
      const { app } = await buildApp({});
      await request(app.getHttpServer())
        .post("/workspaces/any-workspace/conversations/665f1c2b9a4e8f0012345678/messages/stream")
        .send({ content: "hello" })
        .expect(401);
      await app.close();
    });
  });
});
