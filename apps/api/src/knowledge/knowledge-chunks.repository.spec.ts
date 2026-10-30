import { chunkDocumentId, KnowledgeChunksRepository } from "./knowledge-chunks.repository";

describe("KnowledgeChunksRepository (mocked Mongo collection)", () => {
  it("creates scoped indexes, replaces deterministically, and orders reads", async () => {
    const rows = [
      { _id: "a", workspaceId: "ws", fileId: "file", chunkIndex: 0 },
      { _id: "b", workspaceId: "ws", fileId: "file", chunkIndex: 1 },
    ];
    const collection = {
      createIndex: jest.fn().mockResolvedValue("index"),
      listIndexes: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
      dropIndex: jest.fn().mockResolvedValue("dropped"),
      bulkWrite: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      find: jest.fn(() => ({ sort: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(rows) })) })),
    };
    const repository = new KnowledgeChunksRepository({ getDb: () => ({ collection: () => collection }) } as never);
    await repository.onModuleInit();
    expect(collection.createIndex).toHaveBeenCalledWith({ workspaceId: 1, fileId: 1, generationId: 1, chunkIndex: 1 }, expect.objectContaining({ unique: true }));
    const input = [{ chunkIndex: 0, text: "one", wordCount: 1, tokenEstimate: 2 }];
    const result = await repository.replace("ws", "file", "generation-1", input);
    expect(collection.bulkWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ updateOne: expect.objectContaining({
        filter: { workspaceId: "ws", fileId: "file", generationId: "generation-1", chunkIndex: 0 }, upsert: true,
        update: expect.objectContaining({ $setOnInsert: expect.objectContaining({ _id: expect.any(String), createdAt: expect.any(Date) }) }),
      }) }),
    ]), { ordered: true });
    expect(collection.deleteMany).toHaveBeenCalledWith({ workspaceId: "ws", fileId: "file", generationId: "generation-1", chunkIndex: { $nin: [0] } });
    expect(collection.find).toHaveBeenCalledWith({ workspaceId: "ws", fileId: "file", generationId: "generation-1" });
    expect(result.map((row) => row.chunkIndex)).toEqual([0, 1]);
  });

  it("clears only the addressed workspace/file when replacing with an empty document", async () => {
    const collection = { deleteMany: jest.fn().mockResolvedValue({}), find: jest.fn(() => ({ sort: () => ({ toArray: async () => [] }) })) };
    const repository = new KnowledgeChunksRepository({ getDb: () => ({ collection: () => collection }) } as never);
    await repository.replace("ws-a", "file-a", "generation-1", []);
    expect(collection.deleteMany).toHaveBeenCalledWith({ workspaceId: "ws-a", fileId: "file-a", generationId: "generation-1" });
  });

  it("drops only the exact obsolete unique index after creating the generation-scoped index", async () => {
    const collection = {
      createIndex: jest.fn().mockResolvedValue("index"),
      listIndexes: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([
        { name: "knowledge_workspace_file_chunk_unique", unique: true, key: { workspaceId: 1, fileId: 1, chunkIndex: 1 } },
        { name: "user_defined_index", unique: true, key: { workspaceId: 1, fileId: 1 } },
      ]) })),
      dropIndex: jest.fn().mockResolvedValue("dropped"),
    };
    const repository = new KnowledgeChunksRepository({ getDb: () => ({ collection: () => collection }) } as never);
    await repository.onModuleInit();
    expect(collection.dropIndex).toHaveBeenCalledTimes(1);
    expect(collection.dropIndex).toHaveBeenCalledWith("knowledge_workspace_file_chunk_unique");
    expect(collection.createIndex).toHaveBeenNthCalledWith(1,
      { workspaceId: 1, fileId: 1, generationId: 1, chunkIndex: 1 },
      expect.objectContaining({ unique: true }),
    );
  });

  it("derives a stable chunk document ID", () => {
    expect(chunkDocumentId("ws", "file", "gen-a", 2)).toBe(chunkDocumentId("ws", "file", "gen-a", 2));
    expect(chunkDocumentId("ws", "file", "gen-a", 2)).not.toBe(chunkDocumentId("ws", "file", "gen-b", 2));
  });
});
