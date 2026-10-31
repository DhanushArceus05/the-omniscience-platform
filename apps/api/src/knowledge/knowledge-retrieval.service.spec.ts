import { KnowledgeRetrievalService } from "./knowledge-retrieval.service";
import { deterministicPointId } from "./knowledge-vectors.service";

describe("KnowledgeRetrievalService (mocked Prisma, MongoDB, embeddings, and Qdrant)", () => {
  const fileRows = [
    { id: "file-a", originalName: "guide.pdf", activeGenerationId: "gen-a" },
    { id: "file-b", originalName: "notes.txt", activeGenerationId: "gen-b" },
  ];
  const prisma = { knowledgeFile: { findMany: jest.fn() } };
  const workspaces = { getById: jest.fn() };
  const chunks = { listByIds: jest.fn() };
  const embeddings = { embedQuery: jest.fn() };
  const vectors = { search: jest.fn() };
  const readLeases = {
    acquire: jest.fn(async (_owner: string, workspaceId: string, fileId: string, generationId: string) => ({ id: `lease-${fileId}`, workspaceId, fileId, generationId })),
    assertValid: jest.fn().mockResolvedValue(undefined), releaseMany: jest.fn().mockResolvedValue(undefined), release: jest.fn().mockResolvedValue(undefined), renew: jest.fn().mockResolvedValue(true),
  };
  const env = { KNOWLEDGE_RETRIEVAL_LIMIT: 3, KNOWLEDGE_RETRIEVAL_MIN_SCORE: 0.35, KNOWLEDGE_RETRIEVAL_PER_FILE_LIMIT: 2 } as never;
  let service: KnowledgeRetrievalService;

  beforeEach(() => {
    jest.clearAllMocks();
    readLeases.acquire.mockImplementation(async (_owner, workspaceId, fileId, generationId) => ({ id: `lease-${fileId}`, workspaceId, fileId, generationId }));
    workspaces.getById.mockResolvedValue({ id: "workspace-a" });
    prisma.knowledgeFile.findMany.mockResolvedValue(fileRows);
    embeddings.embedQuery.mockResolvedValue(Array(1536).fill(0.1));
    vectors.search.mockResolvedValue([
      hit("file-a", "gen-a", "chunk-a1", 0, 0.9),
      hit("file-a", "gen-old", "stale", 1, 0.99),
      hit("file-b", "gen-b", "chunk-b0", 0, 0.8),
      hit("file-a", "gen-a", "chunk-a2", 1, 0.7),
      hit("file-a", "gen-a", "chunk-a3", 2, 0.6),
      hit("file-a", "gen-a", "low", 3, 0.2),
      hit("file-other", "gen-x", "cross", 0, 0.95, "workspace-other"),
    ]);
    chunks.listByIds.mockImplementation(async (_workspace: string, fileId: string, generationId: string, ids: string[]) =>
      ids.map((id) => ({
        _id: id, workspaceId: "workspace-a", fileId, generationId,
        chunkIndex: id === "chunk-a1" ? 0 : id === "chunk-a2" ? 1 : 0,
        text: `Source text for ${id}`, wordCount: 4, tokenEstimate: 6, pageNumbers: fileId === "file-a" ? [2] : undefined,
      })),
    );
    service = new KnowledgeRetrievalService(prisma as never, workspaces as never, chunks as never, embeddings as never, vectors as never, env, readLeases as never);
  });

  it("embeds the query, searches only the authorized workspace, and accepts active ready generations only", async () => {
    const results = await service.retrieve("owner-a", "workspace-a", "query text");
    expect(workspaces.getById).toHaveBeenCalledWith("owner-a", "workspace-a");
    expect(prisma.knowledgeFile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: "owner-a", workspaceId: "workspace-a", status: "READY", activeGenerationId: { not: null } },
    }));
    expect(vectors.search).toHaveBeenCalledWith("workspace-a", Array(1536).fill(0.1), 12, ["gen-a", "gen-b"]);
    expect(results.map((item) => item.chunkId)).toEqual(["chunk-a1", "chunk-b0", "chunk-a2"]);
    expect(results[0]).toMatchObject({ fileName: "guide.pdf", pageNumbers: [2], score: 0.9 });
    expect(results.every((item) => item.workspaceId === "workspace-a" && item.generationId !== "gen-old")).toBe(true);
  });

  it("drops duplicate chunks, respects the per-file limit and discards missing chunk records", async () => {
    vectors.search.mockResolvedValue([hit("file-a", "gen-a", "chunk-a1", 0, 0.9), hit("file-a", "gen-a", "chunk-a1", 0, 0.89), hit("file-a", "gen-a", "chunk-a2", 1, 0.8), hit("file-a", "gen-a", "chunk-a3", 2, 0.7)]);
    chunks.listByIds.mockImplementation(async (_ws: string, _file: string, _gen: string, ids: string[]) => ids.filter((id) => id !== "chunk-a2").map((id) => ({
      _id: id, workspaceId: "workspace-a", fileId: "file-a", generationId: "gen-a", chunkIndex: id === "chunk-a1" ? 0 : 2,
      text: `Text ${id}`, wordCount: 2, tokenEstimate: 3,
    })));
    const results = await service.retrieve("owner-a", "workspace-a", "query");
    expect(results.map((item) => item.chunkId)).toEqual(["chunk-a1", "chunk-a3"]);
  });

  it("returns an empty result without embedding when the workspace has no READY generation", async () => {
    prisma.knowledgeFile.findMany.mockResolvedValue([]);
    await expect(service.retrieve("owner-a", "workspace-a", "query")).resolves.toEqual([]);
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(vectors.search).not.toHaveBeenCalled();
  });

  it("does not read chunk text if deletion/publication wins before lease acquisition", async () => {
    readLeases.acquire.mockImplementation(async () => null as never);
    const results = await service.retrieve("owner-a", "workspace-a", "query");
    expect(results).toEqual([]);
    expect(chunks.listByIds).not.toHaveBeenCalled();
  });

  it("revalidates files and chunks before citation metadata is used", async () => {
    const sources = await service.retrieve("owner-a", "workspace-a", "query");
    prisma.knowledgeFile.findMany.mockResolvedValue([fileRows[0]]);
    const validated = await service.validateSources("owner-a", "workspace-a", sources);
    expect(validated.map((item) => item.fileId)).toEqual(["file-a", "file-a"]);
    expect(prisma.knowledgeFile.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["file-a", "file-b"] } }) }));
  });

  it("does not run a query for blank or oversized user input", async () => {
    await expect(service.retrieve("owner-a", "workspace-a", "  ")).rejects.toMatchObject({ response: { code: "KNOWLEDGE_QUERY_INVALID" } });
    await expect(service.retrieve("owner-a", "workspace-a", "x".repeat(8001))).rejects.toMatchObject({ response: { code: "KNOWLEDGE_QUERY_INVALID" } });
    expect(vectors.search).not.toHaveBeenCalled();
  });

  it("does not access file metadata or vectors when server-side workspace ownership fails", async () => {
    workspaces.getById.mockRejectedValue({ response: { code: "WORKSPACE_NOT_FOUND" } });
    await expect(service.retrieve("owner-b", "workspace-a", "query")).rejects.toMatchObject({ response: { code: "WORKSPACE_NOT_FOUND" } });
    expect(prisma.knowledgeFile.findMany).not.toHaveBeenCalled();
    expect(vectors.search).not.toHaveBeenCalled();
  });

  function hit(fileId: string, generationId: string, chunkId: string, chunkIndex: number, score: number, workspaceId = "workspace-a") {
    return { id: deterministicPointId(workspaceId, fileId, generationId, chunkIndex), score, payload: { workspaceId, fileId, generationId, chunkId, chunkIndex } };
  }
});
