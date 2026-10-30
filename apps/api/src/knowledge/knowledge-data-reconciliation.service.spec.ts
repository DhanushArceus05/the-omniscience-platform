import { KnowledgeDataReconciliationService } from "./knowledge-data-reconciliation.service";

describe("KnowledgeDataReconciliationService (mocked databases)", () => {
  const logger = { warn: jest.fn() };
  const prisma = { workspace: { findMany: jest.fn() }, knowledgeFile: { findMany: jest.fn(), updateMany: jest.fn() } };
  const chunks = { listArtifacts: jest.fn(), deleteWorkspace: jest.fn(), deleteGeneration: jest.fn() };
  const vectors = { listArtifacts: jest.fn(), deleteWorkspace: jest.fn(), deleteGeneration: jest.fn() };
  let service: KnowledgeDataReconciliationService;
  beforeEach(() => {
    jest.clearAllMocks();
    chunks.listArtifacts.mockResolvedValue([
      { workspaceId: "live", fileId: "f1", generationId: "active" },
      { workspaceId: "live", fileId: "f1", generationId: "stale" },
      { workspaceId: "live", fileId: "f2", generationId: "in-progress" },
      { workspaceId: "live", fileId: "f4", generationId: "expired-attempt" },
      { workspaceId: "orphan", fileId: "f3", generationId: "old" },
    ]);
    vectors.listArtifacts.mockResolvedValue([
      { workspaceId: "live", fileId: "f1", generationId: "stale" },
      { workspaceId: "orphan", fileId: "f3", generationId: "old" },
    ]);
    prisma.workspace.findMany.mockResolvedValue([{ id: "live" }]);
    prisma.knowledgeFile.findMany.mockResolvedValue([
      { id: "f1", workspaceId: "live", status: "READY", activeGenerationId: "active", processingAttemptId: null, updatedAt: new Date() },
      { id: "f2", workspaceId: "live", status: "PROCESSING", activeGenerationId: null, processingAttemptId: "in-progress", updatedAt: new Date() },
      { id: "f4", workspaceId: "live", status: "PROCESSING", activeGenerationId: "previous-ready", processingAttemptId: "expired-attempt", updatedAt: new Date() },
    ]);
    chunks.deleteWorkspace.mockResolvedValue(undefined);
    vectors.deleteWorkspace.mockResolvedValue(undefined);
    chunks.deleteGeneration.mockResolvedValue(undefined);
    vectors.deleteGeneration.mockResolvedValue(undefined);
    service = new KnowledgeDataReconciliationService(prisma as never, chunks as never, vectors as never, logger as never);
  });

  it("removes orphan workspaces and inactive generations while preserving published and processing generations", async () => {
    await expect(service.reconcile()).resolves.toBe(2);
    expect(prisma.workspace.findMany).toHaveBeenCalledWith({ where: { id: { in: ["live", "orphan"] } }, select: { id: true } });
    expect(vectors.deleteWorkspace).toHaveBeenCalledWith("orphan");
    expect(chunks.deleteWorkspace).toHaveBeenCalledWith("orphan");
    expect(vectors.deleteGeneration).toHaveBeenCalledWith("live", "f1", "stale");
    expect(chunks.deleteGeneration).toHaveBeenCalledWith("live", "f1", "stale");
    expect(vectors.deleteGeneration).not.toHaveBeenCalledWith("live", "f1", "active");
    expect(chunks.deleteGeneration).not.toHaveBeenCalledWith("live", "f2", "in-progress");
  });

  it("does not delete anything if PostgreSQL cannot confirm ownership state", async () => {
    prisma.workspace.findMany.mockRejectedValue(new Error("database unavailable"));
    await expect(service.reconcile()).resolves.toBe(0);
    expect(chunks.deleteWorkspace).not.toHaveBeenCalled();
    expect(vectors.deleteWorkspace).not.toHaveBeenCalled();
    expect(chunks.deleteGeneration).not.toHaveBeenCalled();
    expect(vectors.deleteGeneration).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("keeps generation cleanup workspace/file scoped and recoverable when a store fails", async () => {
    vectors.deleteGeneration.mockRejectedValue(new Error("Qdrant unavailable"));
    await expect(service.reconcile()).resolves.toBe(0);
    expect(vectors.deleteGeneration).toHaveBeenCalledWith("live", "f1", "stale");
    expect(chunks.deleteGeneration).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("fences an expired processing attempt before deleting its generation and preserves the prior published generation", async () => {
    const staleAt = new Date(Date.now() - 31 * 60 * 1000);
    prisma.knowledgeFile.findMany.mockResolvedValue([
      { id: "f1", workspaceId: "live", status: "READY", activeGenerationId: "active", processingAttemptId: null, updatedAt: new Date() },
      { id: "f2", workspaceId: "live", status: "PROCESSING", activeGenerationId: null, processingAttemptId: "in-progress", updatedAt: new Date() },
      { id: "f4", workspaceId: "live", status: "PROCESSING", activeGenerationId: "previous-ready", processingAttemptId: "expired-attempt", updatedAt: staleAt },
    ]);
    prisma.knowledgeFile.updateMany.mockResolvedValue({ count: 1 });
    await service.reconcile();
    expect(prisma.knowledgeFile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ processingAttemptId: "expired-attempt", updatedAt: staleAt }),
      data: { status: "READY", processingAttemptId: null, failureReason: null },
    }));
    expect(vectors.deleteGeneration).toHaveBeenCalledWith("live", "f4", "expired-attempt");
    expect(chunks.deleteGeneration).toHaveBeenCalledWith("live", "f4", "expired-attempt");
    expect(vectors.deleteGeneration).not.toHaveBeenCalledWith("live", "f4", "previous-ready");
  });
});
