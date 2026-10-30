import type { Env } from "@omniscience/config";
import type { Logger } from "pino";
import { MongoClient } from "mongodb";
import { MongoService } from "../mongo/mongo.service";
import { KnowledgeChunksRepository } from "./knowledge-chunks.repository";

function isolatedUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = "/omniscience_knowledge_chunks_spec";
  return parsed.toString();
}

const mongoUrl = isolatedUrl(process.env.MONGO_URL ?? "mongodb://omniscience:changeme@localhost:27017/omniscience?authSource=admin");

describe("KnowledgeChunksRepository (real MongoDB integration)", () => {
  let reachable = false;
  let mongo: MongoService;
  let repository: KnowledgeChunksRepository;

  beforeAll(async () => {
    const probe = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 1_000 });
    try {
      await probe.connect();
      await probe.db().listCollections({}, { nameOnly: true }).toArray();
      reachable = true;
    } catch {
      // eslint-disable-next-line no-console
      console.warn("Knowledge chunk MongoDB integration tests skipped: isolated MongoDB database is unavailable.");
    } finally {
      await probe.close().catch(() => undefined);
    }
    if (!reachable) return;
    mongo = new MongoService({ MONGO_URL: mongoUrl } as Env, { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger);
    await mongo.onModuleInit();
    repository = new KnowledgeChunksRepository(mongo);
    await repository.onModuleInit();
  });

  afterAll(async () => {
    if (!reachable) return;
    await mongo.getDb().dropDatabase();
    await mongo.onModuleDestroy();
  });

  it("persists deterministic chunks, replaces stale rows, orders results, and isolates workspaces", async () => {
    if (!reachable) return;
    const indexes = await mongo.getDb().collection("knowledge_chunks").indexes();
    expect(indexes.some((index) => index.name === "knowledge_workspace_file_generation_chunk_unique" && index.unique)).toBe(true);

    await repository.replace("ws-a", "file-a", "gen-a", [
      { chunkIndex: 1, text: "second", wordCount: 1, tokenEstimate: 2 },
      { chunkIndex: 0, text: "first", wordCount: 1, tokenEstimate: 2 },
    ]);
    await repository.replace("ws-b", "file-a", "gen-a", [{ chunkIndex: 0, text: "other workspace", wordCount: 2, tokenEstimate: 3 }]);
    const initial = await repository.list("ws-a", "file-a", "gen-a");
    expect(initial.map((chunk) => chunk.text)).toEqual(["first", "second"]);

    await repository.replace("ws-a", "file-a", "gen-a", [{ chunkIndex: 0, text: "updated", wordCount: 1, tokenEstimate: 2 }]);
    const replaced = await repository.list("ws-a", "file-a", "gen-a");
    expect(replaced).toMatchObject([{ chunkIndex: 0, text: "updated" }]);
    expect(replaced[0]?.createdAt).toEqual(initial[0]?.createdAt);
    expect(await repository.list("ws-b", "file-a", "gen-a")).toMatchObject([{ text: "other workspace" }]);

    await repository.replace("ws-a", "file-a", "gen-b", [{ chunkIndex: 0, text: "staging", wordCount: 1, tokenEstimate: 2 }]);
    expect(await repository.list("ws-a", "file-a", "gen-a")).toMatchObject([{ text: "updated" }]);
    expect(await repository.list("ws-a", "file-a", "gen-b")).toMatchObject([{ text: "staging" }]);
    await repository.deleteGeneration("ws-a", "file-a", "gen-b");
    expect(await repository.list("ws-a", "file-a", "gen-a")).toMatchObject([{ text: "updated" }]);
  });

  afterEach(async () => {
    if (!reachable) return;
    await repository.deleteFile("ws-a", "file-a");
    await repository.deleteFile("ws-b", "file-a");
  });
});
