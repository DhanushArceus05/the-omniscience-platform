import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import type { Conversation, Message, MessageOmniCoreMetadata, MessageRole, MessageStatus } from "@omniscience/types";
import { ObjectId } from "mongodb";
import type { Collection } from "mongodb";
import { MongoService } from "../mongo/mongo.service";

/** The `conversations` collection's on-disk document shape. */
interface ConversationDocument {
  _id: ObjectId;
  workspaceId: string;
  ownerId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessagePreview: string | null;
}

/**
 * The `messages` collection's on-disk document shape.
 *
 * `status` is optional here deliberately: every message persisted
 * before Phase 6 Step 2 has no such field on its Mongo document at
 * all (there was only ever one way for a message to be created, and
 * it always held the complete text). `toMessage` normalizes that
 * absence to `"complete"` — see `MessageStatus`'s own doc comment in
 * `@omniscience/types` — so no migration of existing documents is
 * required. New documents created by the non-streaming `sendMessage`
 * path also omit it, for the same reason it would only ever be
 * `"complete"` there too; only `sendMessageStream` ever writes it
 * explicitly, and only with `"incomplete"` when that's genuinely what
 * happened.
 */
interface MessageDocument {
  _id: ObjectId;
  conversationId: string;
  workspaceId: string;
  ownerId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  omniCore?: MessageOmniCoreMetadata;
  status?: MessageStatus;
}

interface KeysetCursor {
  createdAt: string;
  id: string;
}

export interface CreateMessageInput {
  conversationId: string;
  workspaceId: string;
  ownerId: string;
  role: MessageRole;
  content: string;
  omniCore?: MessageOmniCoreMetadata;
  /**
   * Omit for a message that is unconditionally complete (every
   * non-streaming `sendMessage` call). Pass explicitly — `"complete"`
   * or `"incomplete"` — from `sendMessageStream`, which is the only
   * caller that can ever produce the latter.
   */
  status?: MessageStatus;
}

/**
 * The only file in `ConversationsModule` that touches `MongoService`
 * directly — `ConversationsService` orchestrates, this repository
 * persists. Two collections, not one nested-array document per the
 * approved Step 1 design: `messages` can grow unbounded per
 * conversation without ever risking MongoDB's 16MB document limit,
 * and both can be indexed/paginated independently.
 *
 * `workspaceId`/`ownerId` are denormalized onto every document in
 * both collections (rather than joined against Postgres, which Mongo
 * cannot do) so every ownership check this repository's callers need
 * is answerable from Mongo data alone — the same "never trust
 * anything but the verified caller" reasoning `WorkspacesService`
 * already applies to `ownerId`.
 *
 * Cursors are opaque, self-contained `{ createdAt, id }` pairs
 * (base64url-encoded JSON), not Mongo's native pagination — the exact
 * same reasoning and shape `WorkspacesService`'s `encodeCursor`/
 * `decodeCursor` already established for Prisma, so a cursor can
 * never reveal or depend on whether any particular row still exists.
 */
@Injectable()
export class ConversationsRepository implements OnModuleInit {
  constructor(private readonly mongo: MongoService) {}

  private get conversationsCollection(): Collection<ConversationDocument> {
    return this.mongo.getDb().collection<ConversationDocument>("conversations");
  }

  private get messagesCollection(): Collection<MessageDocument> {
    return this.mongo.getDb().collection<MessageDocument>("messages");
  }

  /**
   * Creates the production-grade indexes both collections need for
   * ownership-scoped, keyset-paginated queries — run once per process
   * lifetime on module init, exactly like `ToolSeedService`/
   * `AiProviderSeedService`'s own `OnModuleInit` seeding pattern.
   * `createIndex` is idempotent (a no-op if an identical index
   * already exists), so this is safe to run on every app start,
   * including against a database from a previous run.
   */
  async onModuleInit(): Promise<void> {
    await this.conversationsCollection.createIndex(
      { ownerId: 1, workspaceId: 1, createdAt: -1, _id: -1 },
      { name: "ownership_scoped_newest_first" },
    );
    await this.messagesCollection.createIndex(
      { conversationId: 1, createdAt: 1, _id: 1 },
      { name: "conversation_scoped_chronological" },
    );
    await this.messagesCollection.createIndex(
      { ownerId: 1, workspaceId: 1 },
      { name: "ownership_scoped_defense_in_depth" },
    );
  }

  async createConversation(ownerId: string, workspaceId: string): Promise<Conversation> {
    const now = new Date();
    const doc: ConversationDocument = {
      _id: new ObjectId(),
      workspaceId,
      ownerId,
      title: null,
      createdAt: now,
      updatedAt: now,
      lastMessagePreview: null,
    };
    await this.conversationsCollection.insertOne(doc);
    return toConversation(doc);
  }

  /**
   * Newest-first, keyset-paginated list of the caller's own
   * conversations within one workspace — never an unbounded query.
   * `limit` is already capped by `listConversationsQuerySchema` before
   * it reaches here.
   */
  async listConversations(
    ownerId: string,
    workspaceId: string,
    params: { limit: number; cursor?: string },
  ): Promise<{ conversations: Conversation[]; nextCursor: string | null }> {
    const cursor = params.cursor ? decodeCursor(params.cursor) : null;

    const rows = await this.conversationsCollection
      .find(
        cursor
          ? {
              ownerId,
              workspaceId,
              $or: [
                { createdAt: { $lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), _id: { $lt: new ObjectId(cursor.id) } },
              ],
            }
          : { ownerId, workspaceId },
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(params.limit + 1)
      .toArray();

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    const last = page[page.length - 1];

    return {
      conversations: page.map(toConversation),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last._id.toHexString() })
          : null,
    };
  }

  /**
   * Returns the caller's own conversation within the named workspace,
   * or `null` — the identical outcome whether `conversationId` doesn't
   * exist at all, belongs to a different owner, or belongs to a
   * different workspace. `ConversationsService` turns `null` into the
   * shared `CONVERSATION_NOT_FOUND` (404), so all three cases are
   * indistinguishable to a caller, same as
   * `WorkspacesService.getById()`.
   */
  async getConversation(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Conversation | null> {
    const doc = await this.conversationsCollection.findOne({
      _id: new ObjectId(conversationId),
      ownerId,
      workspaceId,
    });
    return doc ? toConversation(doc) : null;
  }

  async touchConversation(conversationId: string, lastMessagePreview: string): Promise<void> {
    await this.conversationsCollection.updateOne(
      { _id: new ObjectId(conversationId) },
      { $set: { updatedAt: new Date(), lastMessagePreview } },
    );
  }

  /**
   * Renames the caller's own conversation (Phase 6 Step 4). Filtered
   * by `_id`/`ownerId`/`workspaceId` — the same three-way ownership
   * filter `getConversation` uses — as defense-in-depth even though
   * `ConversationsService.renameConversation()` already resolves
   * ownership via `getOwnedConversationOrThrow()` first. Returns the
   * updated `Conversation`, or `null` if no matching document exists
   * (ownership check already means this shouldn't happen in practice,
   * but the return type stays honest about it rather than assuming).
   */
  async renameConversation(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    title: string,
  ): Promise<Conversation | null> {
    const result = await this.conversationsCollection.findOneAndUpdate(
      { _id: new ObjectId(conversationId), ownerId, workspaceId },
      { $set: { title, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    return result ? toConversation(result) : null;
  }

  /**
   * Deletes the caller's own conversation and every message scoped to
   * it (Phase 6 Step 4) — cascading in application code, not a Mongo
   * transaction: this deployment's standalone (non-replica-set)
   * MongoDB instance doesn't support multi-document transactions (see
   * `claude/PHASE_PLAN.md`'s Step 5 note for the full reasoning), and
   * a two-collection delete like this one doesn't need one — an
   * interrupted deletion here just leaves orphaned message documents
   * scoped to a conversation id nothing can ever read again (every
   * message read in this repository is scoped by `conversationId`
   * *and* ownership, and the conversation itself is what
   * `getConversation`/`listConversations` use to prove ownership), not
   * a user-visible inconsistency. The conversation is deleted first,
   * matching the precedent Phase 2 Step 8's account-deletion flow set
   * (delete the thing granting access, then clean up what it scoped) —
   * ordered so a failure between the two calls can never leave the
   * conversation itself still visible with unreachable messages
   * appearing to be missing.
   *
   * Returns whether a conversation was actually found and deleted —
   * `ConversationsService` uses this to distinguish "you don't own
   * this" from "already gone", though today both are treated
   * identically by the caller (see the service's own doc comment).
   */
  async deleteConversation(ownerId: string, workspaceId: string, conversationId: string): Promise<boolean> {
    const result = await this.conversationsCollection.deleteOne({
      _id: new ObjectId(conversationId),
      ownerId,
      workspaceId,
    });
    if (result.deletedCount === 0) {
      return false;
    }
    await this.messagesCollection.deleteMany({ conversationId, ownerId, workspaceId });
    return true;
  }

  async createMessage(input: CreateMessageInput): Promise<Message> {
    const doc: MessageDocument = {
      _id: new ObjectId(),
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      role: input.role,
      content: input.content,
      createdAt: new Date(),
      ...(input.omniCore ? { omniCore: input.omniCore } : {}),
      ...(input.status ? { status: input.status } : {}),
    };
    await this.messagesCollection.insertOne(doc);
    return toMessage(doc);
  }

  /**
   * The conversation's current true last message (by the exact same
   * `createdAt`+`_id` ordering `listMessages()` already uses — just
   * descending here instead of ascending), or `null` for an empty
   * conversation. Scoped by `conversationId`+`ownerId`+`workspaceId`,
   * same isolation as every other message read in this repository — a
   * caller can never learn anything about another owner's or another
   * conversation's messages through this method.
   */
  async getLastMessage(ownerId: string, workspaceId: string, conversationId: string): Promise<Message | null> {
    const rows = await this.messagesCollection
      .find({ conversationId, ownerId, workspaceId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(1)
      .toArray();
    return rows[0] ? toMessage(rows[0]) : null;
  }

  /**
   * Deletes `messageId` (Phase 6 Step 5 — Message-Level UX), but only
   * ever when it is genuinely the conversation's current last message
   * — re-derived here from the database on every call via
   * `getLastMessage()` above, never trusted from the caller. This is
   * the one guarded primitive `ConversationsService` builds regenerate
   * (delete the last assistant reply) and edit-and-resend (delete the
   * last assistant reply if present, then the now-last user message)
   * on top of — there is deliberately no general "delete any message"
   * operation anywhere in this repository.
   *
   * Returns `"deleted"`, `"not_found"` (no message with this id exists
   * for this owner/workspace/conversation — the same no-enumeration
   * shape `deleteConversation()` already returns as `false`, just
   * spelled out as a named outcome here since a third outcome exists
   * too), or `"not_last"` (the message exists and is the caller's, but
   * isn't — or is no longer — the last message). `ConversationsService`
   * maps the last two to the distinct `MESSAGE_NOT_FOUND`/
   * `MESSAGE_NOT_LAST` domain errors.
   */
  async deleteMessage(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    messageId: string,
  ): Promise<"deleted" | "not_found" | "not_last"> {
    const last = await this.getLastMessage(ownerId, workspaceId, conversationId);
    if (!last) {
      return "not_found";
    }
    if (last.id !== messageId) {
      // Distinguishing "not last" from "not found" here costs one more
      // read (does a message with this id exist at all, for this
      // owner/workspace/conversation?) — worth it so a caller attempting
      // to delete a message that's genuinely theirs but stale gets the
      // conflict code rather than a misleading "not found".
      const exists = await this.messagesCollection.findOne({
        _id: new ObjectId(messageId),
        conversationId,
        ownerId,
        workspaceId,
      });
      return exists ? "not_last" : "not_found";
    }

    const result = await this.messagesCollection.deleteOne({
      _id: new ObjectId(messageId),
      conversationId,
      ownerId,
      workspaceId,
    });
    return result.deletedCount > 0 ? "deleted" : "not_found";
  }

  /**
   * Chronological (oldest-first) keyset-paginated reload of a
   * conversation's messages — reading order, not newest-first like
   * `listConversations`. Scoped by `conversationId` (the collection's
   * primary access pattern) plus `ownerId`/`workspaceId` as
   * defense-in-depth, so a caller can never read another owner's
   * messages even if a `conversationId` were somehow guessed.
   */
  async listMessages(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    params: { limit: number; cursor?: string },
  ): Promise<{ messages: Message[]; nextCursor: string | null }> {
    const cursor = params.cursor ? decodeCursor(params.cursor) : null;

    const rows = await this.messagesCollection
      .find(
        cursor
          ? {
              conversationId,
              ownerId,
              workspaceId,
              $or: [
                { createdAt: { $gt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), _id: { $gt: new ObjectId(cursor.id) } },
              ],
            }
          : { conversationId, ownerId, workspaceId },
      )
      .sort({ createdAt: 1, _id: 1 })
      .limit(params.limit + 1)
      .toArray();

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    const last = page[page.length - 1];

    return {
      messages: page.map(toMessage),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last._id.toHexString() })
          : null,
    };
  }
}

function toConversation(doc: ConversationDocument): Conversation {
  return {
    id: doc._id.toHexString(),
    workspaceId: doc.workspaceId,
    title: doc.title,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toMessage(doc: MessageDocument): Message {
  return {
    id: doc._id.toHexString(),
    conversationId: doc.conversationId,
    role: doc.role,
    content: doc.content,
    createdAt: doc.createdAt.toISOString(),
    ...(doc.omniCore ? { omniCore: doc.omniCore } : {}),
    // Legacy documents predating Phase 6 Step 2 have no `status` field
    // at all — normalized to "complete" here, not by migrating those
    // documents, per `MessageStatus`'s doc comment.
    status: doc.status ?? "complete",
  };
}

function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): KeysetCursor {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Partial<KeysetCursor>).createdAt === "string" &&
      typeof (parsed as Partial<KeysetCursor>).id === "string" &&
      !Number.isNaN(Date.parse((parsed as KeysetCursor).createdAt)) &&
      ObjectId.isValid((parsed as KeysetCursor).id)
    ) {
      return parsed as KeysetCursor;
    }
  } catch {
    // fall through to the shared rejection below
  }
  throw new BadRequestException({ code: "INVALID_CURSOR", message: "The pagination cursor is invalid." });
}
