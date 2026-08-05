import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

/**
 * Minimal in-memory stand-in for the slice of the native MongoDB
 * driver's `Collection<T>` API `ConversationsRepository` actually
 * uses: `insertOne`, `findOne`, `find().sort().limit().toArray()`,
 * `updateOne`, `findOneAndUpdate`, `deleteOne`, `deleteMany`,
 * `createIndex` (the last four added in Phase 6 Step 4, for
 * `renameConversation()`/`deleteConversation()`). Not a
 * general-purpose Mongo query engine — it supports exactly the
 * filter/sort shapes this repository issues (equality matches, `$or`
 * of two keyset-cursor branches, `$lt`/`$gt` comparisons on
 * `createdAt`/`_id`, two-key ascending/descending sorts) — the same
 * "reproduce the logic this codebase actually needs, not the whole
 * product" reasoning `InMemoryRedisClient` (`fake-redis.service.ts`)
 * already documents for its own scope.
 *
 * Real keyset-pagination *correctness* against a real MongoDB
 * instance — index usage, real BSON comparison semantics — is proven
 * separately in `conversations.repository.spec.ts`'s real-Mongo suite
 * (same "unit tests use a fake, a dedicated spec proves the real
 * thing" split `RefreshTokenStore`'s concurrency spec already
 * establishes for Redis). This fake exists purely so every other e2e
 * spec that boots the real `AppModule` (which, via `ConversationsModule`,
 * always needs a `MongoService` regardless of which routes a given
 * suite actually exercises) doesn't require a live MongoDB instance.
 */

type Filter = Record<string, unknown>;
interface Doc {
  _id: ObjectId;
  [key: string]: unknown;
}

function comparableValue(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (value instanceof ObjectId) return value.toHexString();
  return value;
}

function compare(a: unknown, b: unknown): number {
  const av = comparableValue(a);
  const bv = comparableValue(b);
  if (av === bv) return 0;
  return av !== null && bv !== null && av !== undefined && bv !== undefined && av < bv ? -1 : 1;
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !(value instanceof ObjectId)
  );
}

function matches(doc: Doc, filter: Filter): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === "$or") {
      const branches = condition as Filter[];
      if (!branches.some((branch) => matches(doc, branch))) return false;
      continue;
    }
    const value = doc[key];
    if (isOperatorObject(condition)) {
      for (const [op, opValue] of Object.entries(condition)) {
        if (op === "$lt" && !(compare(value, opValue) < 0)) return false;
        if (op === "$gt" && !(compare(value, opValue) > 0)) return false;
        if (op === "$lte" && !(compare(value, opValue) <= 0)) return false;
        if (op === "$gte" && !(compare(value, opValue) >= 0)) return false;
      }
    } else if (!valueEquals(value, condition)) {
      return false;
    }
  }
  return true;
}

class InMemoryCollection<T extends Doc> {
  private readonly docs: T[] = [];

  async insertOne(doc: T): Promise<{ insertedId: ObjectId }> {
    this.docs.push(doc);
    return { insertedId: doc._id };
  }

  async findOne(filter: Filter): Promise<T | null> {
    return this.docs.find((doc) => matches(doc, filter)) ?? null;
  }

  find(filter: Filter): {
    sort: (spec: Record<string, 1 | -1>) => ReturnType<InMemoryCollection<T>["find"]>;
    limit: (n: number) => ReturnType<InMemoryCollection<T>["find"]>;
    toArray: () => Promise<T[]>;
  } {
    let results = this.docs.filter((doc) => matches(doc, filter));
    let sortSpec: Record<string, 1 | -1> | null = null;
    let limitN: number | null = null;

    const cursor = {
      sort: (spec: Record<string, 1 | -1>) => {
        sortSpec = spec;
        return cursor;
      },
      limit: (n: number) => {
        limitN = n;
        return cursor;
      },
      toArray: async (): Promise<T[]> => {
        let out = [...results];
        if (sortSpec) {
          const entries = Object.entries(sortSpec);
          out = out.sort((a, b) => {
            for (const [key, dir] of entries) {
              const cmp = compare(a[key], b[key]);
              if (cmp !== 0) return dir === 1 ? cmp : -cmp;
            }
            return 0;
          });
        }
        if (limitN !== null) out = out.slice(0, limitN);
        results = out;
        return out;
      },
    };
    return cursor;
  }

  async updateOne(filter: Filter, update: { $set: Record<string, unknown> }): Promise<{ matchedCount: number }> {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) return { matchedCount: 0 };
    Object.assign(doc, update.$set);
    return { matchedCount: 1 };
  }

  /**
   * Real driver signature: `findOneAndUpdate(filter, update, { returnDocument })`.
   * Only `returnDocument: "after"` is supported — the only variant
   * `ConversationsRepository.renameConversation()` uses — returning
   * the updated document, or `null` if nothing matched (matching the
   * real driver's `ModifyResult`-less, direct-document return shape
   * used by this codebase's `mongodb` driver version).
   */
  async findOneAndUpdate(
    filter: Filter,
    update: { $set: Record<string, unknown> },
    _options: { returnDocument: "after" },
  ): Promise<T | null> {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) return null;
    Object.assign(doc, update.$set);
    return doc;
  }

  async deleteOne(filter: Filter): Promise<{ deletedCount: number }> {
    const index = this.docs.findIndex((d) => matches(d, filter));
    if (index === -1) return { deletedCount: 0 };
    this.docs.splice(index, 1);
    return { deletedCount: 1 };
  }

  async deleteMany(filter: Filter): Promise<{ deletedCount: number }> {
    const before = this.docs.length;
    const remaining = this.docs.filter((d) => !matches(d, filter));
    const deletedCount = before - remaining.length;
    this.docs.length = 0;
    this.docs.push(...remaining);
    return { deletedCount };
  }

  async createIndex(): Promise<string> {
    // No-op: this fake has no real indexes to build — index creation
    // is exercised for real in `conversations.repository.spec.ts`'s
    // real-Mongo suite instead.
    return "noop-index";
  }
}

export class FakeMongoService {
  private readonly collections = new Map<string, InMemoryCollection<Doc>>();

  async onModuleInit(): Promise<void> {
    // no-op
  }

  async onModuleDestroy(): Promise<void> {
    // no-op
  }

  getDb(): Db {
    const collections = this.collections;
    return {
      collection: (name: string) => {
        if (!collections.has(name)) {
          collections.set(name, new InMemoryCollection<Doc>());
        }
        return collections.get(name);
      },
    } as unknown as Db;
  }
}
