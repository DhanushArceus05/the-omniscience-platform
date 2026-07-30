import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import type { Conversation, Message, MessageOmniCoreMetadata, MessageRole } from "@omniscience/types";
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

/** The `messages` collection's on-disk document shape. */
interface MessageDocument {
  _id: ObjectId;
  conversationId: string;
  workspaceId: string;
  ownerId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  omniCore?: MessageOmniCoreMetadata;
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
    };
    await this.messagesCollection.insertOne(doc);
    return toMessage(doc);
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
