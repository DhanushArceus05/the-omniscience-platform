import type { Env } from "@omniscience/config";
import type { Message } from "@omniscience/types";
import { MongoClient } from "mongodb";
import type { Logger } from "pino";
import { MongoService } from "../mongo/mongo.service";
import { ConversationsRepository } from "./conversations.repository";

/**
 * Real-Mongo proof for Phase 6 Step 1's keyset pagination and
 * production-grade indexes, mirroring
 * `refresh-token.store.concurrency.spec.ts`'s rationale: the in-memory
 * `FakeMongoService` (`apps/api/test/helpers/fake-mongo.service.ts`)
 * used by every e2e spec has no real BSON comparison or index
 * semantics of its own, so it cannot prove this repository's queries
 * actually behave correctly against a real MongoDB instance. This runs
 * every repository method against one.
 *
 * Requires a MongoDB reachable at `MONGO_URL` (or the repository's own
 * documented local dev default — see `.env.example`'s `MONGO_URL` /
 * `docker-compose.yml`'s `mongo` service, which always runs with a
 * root user configured via `MONGO_USER`/`MONGO_PASSWORD`, defaulting
 * to `omniscience`/`changeme`) — set by the `mongo` service container
 * in `.github/workflows/ci.yml` for CI. Skips its assertions (passes
 * trivially, with a console warning) if no authenticated MongoDB is
 * reachable, so `pnpm test` still passes without local infra.
 *
 * **Isolation is not merely a fallback convention here — it's
 * enforced.** `MONGO_URL` in a developer's real shell/`.env` typically
 * names the actual working dev database (e.g. `.env.example`'s own
 * documented default points at `omniscience`), and this suite's
 * `afterAll` calls `dropDatabase()`. Trusting whatever database name
 * happens to be in `MONGO_URL` would risk dropping a real dev
 * database. Instead, `withIsolatedTestDatabase()` below takes whatever
 * `MONGO_URL` is configured (env var or the repo's documented default)
 * and rewrites *only* its path component to this suite's own dedicated
 * `omniscience_repository_spec` database, preserving the host, port,
 * credentials, and auth-source query param exactly as configured — so
 * this suite always authenticates with real, correct credentials
 * against the real server, but only ever reads, writes, and drops its
 * own database, never whatever database the ambient `MONGO_URL`
 * actually points at.
 */
function withIsolatedTestDatabase(url: string): string {
  const isolated = new URL(url);
  isolated.pathname = "/omniscience_repository_spec";
  return isolated.toString();
}

const MONGO_URL = withIsolatedTestDatabase(
  process.env.MONGO_URL ?? "mongodb://omniscience:changeme@localhost:27017/omniscience?authSource=admin",
);

/**
 * `ping` deliberately does not require authentication in MongoDB, even
 * with auth enabled — so probing with `{ ping: 1 }` alone cannot tell
 * a genuinely reachable, correctly authenticated server apart from a
 * reachable server this suite has the *wrong* credentials for. Both
 * would report "reachable", and only the latter would then fail loudly
 * and confusingly on this suite's real `createIndexes`/`dropDatabase`
 * calls instead of skipping gracefully. `listCollections` (an empty or
 * nonexistent collection list is fine — this suite only cares whether
 * the command itself is authorized) requires the same read privilege
 * every other command in this suite needs, so a credential mismatch is
 * caught here and reported as "unreachable" instead.
 */
async function isReachable(url: string): Promise<boolean> {
  const probe = new MongoClient(url, { serverSelectionTimeoutMS: 1_000 });
  try {
    await probe.connect();
    await probe.db().listCollections({}, { nameOnly: true }).toArray();
    return true;
  } catch {
    return false;
  } finally {
    await probe.close().catch(() => undefined);
  }
}

/**
 * Narrows `T | undefined` to `T`, throwing a clear, test-specific error
 * if the value is missing — used in place of a non-null assertion
 * (`!`) wherever this suite indexes into an array whose length was
 * just asserted, so a genuine regression (an unexpectedly short array)
 * fails with a readable message instead of a raw `undefined` property
 * access.
 */
function assertDefined<T>(value: T | undefined, message = "Expected value to be defined"): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

describe("ConversationsRepository (real MongoDB)", () => {
  let reachable = false;
  let mongoService: MongoService;
  let repository: ConversationsRepository;

  beforeAll(async () => {
    reachable = await isReachable(MONGO_URL);
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn(
        `ConversationsRepository spec: no MongoDB reachable at ${MONGO_URL} — skipping. ` +
          "Start a local MongoDB (e.g. `docker compose up -d mongo`) or run in CI, where the `mongo` service container provides one.",
      );
      return;
    }

    const env = { MONGO_URL } as unknown as Env;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;
    mongoService = new MongoService(env, logger);
    await mongoService.onModuleInit();

    repository = new ConversationsRepository(mongoService);
    await repository.onModuleInit();
  });

  afterAll(async () => {
    if (!reachable) return;
    await mongoService.getDb().dropDatabase();
    await mongoService.onModuleDestroy();
  });

  beforeEach(async () => {
    if (!reachable) return;
    await mongoService.getDb().collection("conversations").deleteMany({});
    await mongoService.getDb().collection("messages").deleteMany({});
  });

  it("creates production-grade indexes on both collections", async () => {
    if (!reachable) return;

    const conversationIndexes = await mongoService.getDb().collection("conversations").indexes();
    const messageIndexes = await mongoService.getDb().collection("messages").indexes();

    expect(conversationIndexes.some((idx) => idx.name === "ownership_scoped_newest_first")).toBe(true);
    expect(messageIndexes.some((idx) => idx.name === "conversation_scoped_chronological")).toBe(true);
    expect(messageIndexes.some((idx) => idx.name === "ownership_scoped_defense_in_depth")).toBe(true);
  });

  it("creates a conversation with a null title, owned by the caller", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");

    expect(conversation.title).toBeNull();
    expect(conversation.workspaceId).toBe("workspace_1");
    expect(conversation.id).toMatch(/^[0-9a-f]{24}$/);
  });

  it("lists only the owner's conversations in the named workspace, newest first", async () => {
    if (!reachable) return;

    const first = await repository.createConversation("user_1", "workspace_1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await repository.createConversation("user_1", "workspace_1");
    await repository.createConversation("user_1", "workspace_2");
    await repository.createConversation("user_2", "workspace_1");

    const { conversations, nextCursor } = await repository.listConversations("user_1", "workspace_1", {
      limit: 20,
    });

    expect(conversations.map((c) => c.id)).toEqual([second.id, first.id]);
    expect(nextCursor).toBeNull();
  });

  it("paginates conversations with a bounded limit and a usable nextCursor", async () => {
    if (!reachable) return;

    for (let i = 0; i < 5; i += 1) {
      await repository.createConversation("user_1", "workspace_1");
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const firstPage = await repository.listConversations("user_1", "workspace_1", { limit: 2 });
    expect(firstPage.conversations).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await repository.listConversations("user_1", "workspace_1", {
      limit: 2,
      cursor: firstPage.nextCursor as string,
    });
    expect(secondPage.conversations).toHaveLength(2);
    expect(secondPage.conversations.map((c) => c.id)).not.toEqual(
      firstPage.conversations.map((c) => c.id),
    );
  });

  it("returns null for a conversation belonging to a different owner", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");

    const result = await repository.getConversation("user_2", "workspace_1", conversation.id);

    expect(result).toBeNull();
  });

  it("returns null for a conversation in a different workspace than requested", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");

    const result = await repository.getConversation("user_1", "workspace_2", conversation.id);

    expect(result).toBeNull();
  });

  it("persists a message and lists messages within a conversation in chronological order", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    const first = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "Hello, OmniCore.",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "assistant",
      content: "Hello! How can I help?",
      omniCore: {
        planId: "plan_1",
        intent: "simple-generation",
        matchedRuleId: "fast-rule.simple-generation",
        confidence: 0.9,
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
        taskPlanId: "task-plan_1",
      },
    });

    const { messages, nextCursor } = await repository.listMessages(
      "user_1",
      "workspace_1",
      conversation.id,
      { limit: 20 },
    );

    expect(messages.map((m) => m.id)).toEqual([first.id, second.id]);
    const [, secondMessage] = messages;
    expect(assertDefined(secondMessage, "Expected a second message").omniCore?.providerId).toBe(
      "anthropic",
    );
    expect(nextCursor).toBeNull();
  });

  it("normalizes a message with no explicit status to \"complete\" — the non-streaming sendMessage path (Phase 6 Step 1) never passes status", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    const message = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "Hello, OmniCore.",
    });

    expect(message.status).toBe("complete");

    const { messages } = await repository.listMessages("user_1", "workspace_1", conversation.id, {
      limit: 20,
    });
    expect(messages[0]?.status).toBe("complete");
  });

  it("persists and round-trips an explicit \"incomplete\" status — the streaming sendMessageStream path (Phase 6 Step 2)", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    const message = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "assistant",
      content: "This response was cut sh",
      status: "incomplete",
      omniCore: {
        planId: "plan_1",
        intent: "simple-generation",
        matchedRuleId: "fast-rule.simple-generation",
        confidence: 0.9,
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
        taskPlanId: "task-plan_1",
      },
    });

    expect(message.status).toBe("incomplete");

    const { messages } = await repository.listMessages("user_1", "workspace_1", conversation.id, {
      limit: 20,
    });
    expect(messages[0]?.status).toBe("incomplete");
  });

  it("paginates messages chronologically with a bounded limit and a usable nextCursor", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    const created: Message[] = [];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const message = await repository.createMessage({
        conversationId: conversation.id,
        workspaceId: "workspace_1",
        ownerId: "user_1",
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
      });
      created.push(message);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const [createdFirst, createdSecond, createdThird, createdFourth] = created;

    const firstPage = await repository.listMessages("user_1", "workspace_1", conversation.id, {
      limit: 2,
    });
    expect(firstPage.messages).toHaveLength(2);
    const [firstPageMessage0, firstPageMessage1] = firstPage.messages;
    expect(assertDefined(firstPageMessage0, "Expected the first page's first message").id).toBe(
      assertDefined(createdFirst, "Expected a first created message").id,
    );
    expect(assertDefined(firstPageMessage1, "Expected the first page's second message").id).toBe(
      assertDefined(createdSecond, "Expected a second created message").id,
    );
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await repository.listMessages("user_1", "workspace_1", conversation.id, {
      limit: 2,
      cursor: firstPage.nextCursor as string,
    });
    expect(secondPage.messages).toHaveLength(2);
    const [secondPageMessage0, secondPageMessage1] = secondPage.messages;
    expect(assertDefined(secondPageMessage0, "Expected the second page's first message").id).toBe(
      assertDefined(createdThird, "Expected a third created message").id,
    );
    expect(assertDefined(secondPageMessage1, "Expected the second page's second message").id).toBe(
      assertDefined(createdFourth, "Expected a fourth created message").id,
    );
  });

  it("does not leak messages from another conversation, even within the same workspace", async () => {
    if (!reachable) return;

    const conversationA = await repository.createConversation("user_1", "workspace_1");
    const conversationB = await repository.createConversation("user_1", "workspace_1");
    await repository.createMessage({
      conversationId: conversationA.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "In conversation A",
    });
    await repository.createMessage({
      conversationId: conversationB.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "In conversation B",
    });

    const { messages } = await repository.listMessages("user_1", "workspace_1", conversationA.id, {
      limit: 20,
    });

    expect(messages).toHaveLength(1);
    const [onlyMessage] = messages;
    expect(assertDefined(onlyMessage, "Expected exactly one message").content).toBe(
      "In conversation A",
    );
  });

  it("updates the conversation's updatedAt and lastMessagePreview when touched", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");

    await repository.touchConversation(conversation.id, "A preview of the latest message");

    const reloaded = await repository.getConversation("user_1", "workspace_1", conversation.id);
    expect(reloaded).not.toBeNull();
    expect(new Date(reloaded?.updatedAt as string).getTime()).toBeGreaterThanOrEqual(
      new Date(conversation.updatedAt).getTime(),
    );
  });

  it("rejects a malformed pagination cursor", async () => {
    if (!reachable) return;

    await expect(
      repository.listConversations("user_1", "workspace_1", { limit: 20, cursor: "not-valid-base64url!" }),
    ).rejects.toThrow();
  });

  it("renames a conversation, updating title and updatedAt (Phase 6 Step 4)", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");

    const renamed = await repository.renameConversation(
      "user_1",
      "workspace_1",
      conversation.id,
      "My renamed conversation",
    );

    expect(renamed).not.toBeNull();
    expect(renamed?.title).toBe("My renamed conversation");
    expect(new Date(renamed?.updatedAt as string).getTime()).toBeGreaterThanOrEqual(
      new Date(conversation.updatedAt).getTime(),
    );

    const reloaded = await repository.getConversation("user_1", "workspace_1", conversation.id);
    expect(reloaded?.title).toBe("My renamed conversation");
  });

  it("returns null when renaming a conversation belonging to a different owner, without changing it", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");

    const result = await repository.renameConversation(
      "user_2",
      "workspace_1",
      conversation.id,
      "Hijacked title",
    );

    expect(result).toBeNull();
    const reloaded = await repository.getConversation("user_1", "workspace_1", conversation.id);
    expect(reloaded?.title).toBeNull();
  });

  it("deletes a conversation and cascades to every message it owned (Phase 6 Step 4)", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "Hello, OmniCore.",
    });
    await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "assistant",
      content: "Hello! How can I help?",
    });

    const deleted = await repository.deleteConversation("user_1", "workspace_1", conversation.id);

    expect(deleted).toBe(true);
    expect(await repository.getConversation("user_1", "workspace_1", conversation.id)).toBeNull();
    const { messages } = await repository.listMessages("user_1", "workspace_1", conversation.id, {
      limit: 20,
    });
    expect(messages).toHaveLength(0);
  });

  it("does not delete a conversation belonging to a different owner, and leaves its messages intact", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "Still here",
    });

    const deleted = await repository.deleteConversation("user_2", "workspace_1", conversation.id);

    expect(deleted).toBe(false);
    expect(await repository.getConversation("user_1", "workspace_1", conversation.id)).not.toBeNull();
    const { messages } = await repository.listMessages("user_1", "workspace_1", conversation.id, {
      limit: 20,
    });
    expect(messages).toHaveLength(1);
  });

  it("does not leak a delete across conversations — deleting one conversation's messages never touches another's", async () => {
    if (!reachable) return;

    const conversationA = await repository.createConversation("user_1", "workspace_1");
    const conversationB = await repository.createConversation("user_1", "workspace_1");
    await repository.createMessage({
      conversationId: conversationA.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "In conversation A",
    });
    await repository.createMessage({
      conversationId: conversationB.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "In conversation B",
    });

    await repository.deleteConversation("user_1", "workspace_1", conversationA.id);

    const { messages } = await repository.listMessages("user_1", "workspace_1", conversationB.id, {
      limit: 20,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("In conversation B");
  });

  it("returns false when deleting an already-gone conversation id", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    const firstDelete = await repository.deleteConversation("user_1", "workspace_1", conversation.id);
    expect(firstDelete).toBe(true);

    const secondDelete = await repository.deleteConversation("user_1", "workspace_1", conversation.id);
    expect(secondDelete).toBe(false);
  });

  it("getLastMessage returns null for an empty conversation (Phase 6 Step 5)", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    const last = await repository.getLastMessage("user_1", "workspace_1", conversation.id);
    expect(last).toBeNull();
  });

  it("getLastMessage returns the only message in a single-message conversation", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    const message = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "Only message",
    });

    const last = await repository.getLastMessage("user_1", "workspace_1", conversation.id);
    expect(last?.id).toBe(message.id);
  });

  it("getLastMessage returns the true most recent message across many", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "First",
    });
    await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "assistant",
      content: "Second",
    });
    const third = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "Third",
    });

    const last = await repository.getLastMessage("user_1", "workspace_1", conversation.id);
    expect(last?.id).toBe(third.id);
  });

  it("deleteMessage deletes the true last message (Phase 6 Step 5)", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "First",
    });
    const second = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "assistant",
      content: "Second",
    });

    const outcome = await repository.deleteMessage("user_1", "workspace_1", conversation.id, second.id);

    expect(outcome).toBe("deleted");
    const { messages } = await repository.listMessages("user_1", "workspace_1", conversation.id, { limit: 20 });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("First");
  });

  it("deleteMessage rejects a non-last message with \"not_last\"", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    const first = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "First",
    });
    await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "assistant",
      content: "Second",
    });

    const outcome = await repository.deleteMessage("user_1", "workspace_1", conversation.id, first.id);

    expect(outcome).toBe("not_last");
    const { messages } = await repository.listMessages("user_1", "workspace_1", conversation.id, { limit: 20 });
    expect(messages).toHaveLength(2);
  });

  it("deleteMessage rejects another owner's message with \"not_found\"", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    const message = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "Only message",
    });

    const outcome = await repository.deleteMessage("user_2", "workspace_1", conversation.id, message.id);

    expect(outcome).toBe("not_found");
    const { messages } = await repository.listMessages("user_1", "workspace_1", conversation.id, { limit: 20 });
    expect(messages).toHaveLength(1);
  });

  it("deleteMessage rejects an invalid/nonexistent message id with \"not_found\"", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "Only message",
    });

    const outcome = await repository.deleteMessage(
      "user_1",
      "workspace_1",
      conversation.id,
      "665f1c2b9a4e8f0012345678",
    );

    expect(outcome).toBe("not_found");
  });

  it("deleteMessage correctly re-derives the new last message after a previous deletion", async () => {
    if (!reachable) return;

    const conversation = await repository.createConversation("user_1", "workspace_1");
    const first = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "First",
    });
    const second = await repository.createMessage({
      conversationId: conversation.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "assistant",
      content: "Second",
    });

    const firstOutcome = await repository.deleteMessage("user_1", "workspace_1", conversation.id, second.id);
    expect(firstOutcome).toBe("deleted");

    // `first` is now the true last message — deleting it should
    // succeed too, proving "last" is re-derived fresh each call, not
    // cached from before the prior delete.
    const secondOutcome = await repository.deleteMessage("user_1", "workspace_1", conversation.id, first.id);
    expect(secondOutcome).toBe("deleted");

    const last = await repository.getLastMessage("user_1", "workspace_1", conversation.id);
    expect(last).toBeNull();
  });

  it("deleteMessage never deletes across conversations", async () => {
    if (!reachable) return;

    const conversationA = await repository.createConversation("user_1", "workspace_1");
    const conversationB = await repository.createConversation("user_1", "workspace_1");
    const messageInB = await repository.createMessage({
      conversationId: conversationB.id,
      workspaceId: "workspace_1",
      ownerId: "user_1",
      role: "user",
      content: "In conversation B",
    });

    // Attempting to delete B's message while scoped to conversation A
    // must not find it at all (not "not_last" — genuinely not found
    // within A's scope).
    const outcome = await repository.deleteMessage("user_1", "workspace_1", conversationA.id, messageInB.id);

    expect(outcome).toBe("not_found");
    const { messages } = await repository.listMessages("user_1", "workspace_1", conversationB.id, { limit: 20 });
    expect(messages).toHaveLength(1);
  });
});
