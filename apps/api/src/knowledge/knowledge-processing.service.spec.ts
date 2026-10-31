import { BadRequestException } from "@nestjs/common";
import { KnowledgeProcessingService } from "./knowledge-processing.service";

const freshFile = (overrides: Record<string, unknown> = {}) => ({
  id: "file", ownerId: "owner", workspaceId: "ws", status: "UPLOADED", storageKey: "safe.pdf",
  mimeType: "text/plain", updatedAt: new Date(), processingAttemptId: null, activeGenerationId: null,
  chunkCount: null, failureReason: null, ...overrides,
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(overrides: { file?: ReturnType<typeof freshFile>; extract?: jest.Mock; embedBatches?: jest.Mock; upsertBatch?: jest.Mock; chunked?: jest.Mock; waitForGenerationDrain?: jest.Mock } = {}) {
  let row: ReturnType<typeof freshFile> | null = overrides.file ?? freshFile();
  let transactionTail = Promise.resolve();
  const matches = (where: Record<string, unknown>) => {
    if (!row) return false;
    for (const [key, expected] of Object.entries(where)) {
      const actual = (row as unknown as Record<string, unknown>)[key];
      if (key === "status" && typeof expected === "object" && expected !== null && "in" in expected) {
        if (!(expected.in as unknown[]).includes(actual)) return false;
      } else if (actual instanceof Date && expected instanceof Date) {
        if (actual.getTime() !== expected.getTime()) return false;
      } else if (actual !== expected) return false;
    }
    return true;
  };
  const applyUpdateMany = jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (!matches(where) || !row) return { count: 0 };
    row = { ...row, ...data, updatedAt: data.updatedAt as Date | undefined ?? new Date() };
    return { count: 1 };
  });
  const updateMany = jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (args.data.status === "DELETING") await transactionTail;
    return applyUpdateMany(args);
  });
  const findFirst = jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(where) ? { ...row } : null);
  const deleteMany = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    if (!matches(where)) return { count: 0 };
    row = null;
    return { count: 1 };
  });
  const prisma = {
    knowledgeFile: { findFirst, updateMany, deleteMany },
    $transaction: jest.fn(async (callback: (tx: {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>;
      knowledgeFile: { updateMany: typeof applyUpdateMany };
    }) => Promise<unknown>) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback({
          $queryRaw: async (_strings, ...values) => {
            const [fileId, workspaceId, ownerId, attemptId] = values;
            if (!row || row.id !== fileId || row.workspaceId !== workspaceId || row.ownerId !== ownerId) return [];
            if (values.length === 3) return [{ ...row }];
            return row.processingAttemptId === attemptId && ["PROCESSING", "EXTRACTED", "EMBEDDING_PENDING"].includes(row.status)
              ? [{ id: row.id }] : [];
          },
          knowledgeFile: { updateMany: applyUpdateMany },
        });
      } finally { release(); }
    }),
  };
  const persistedChunks = jest.fn(async (workspaceId: string, fileId: string, generationId: string, chunks: Array<Record<string, unknown>>) =>
    chunks.map((chunk) => ({ ...chunk, _id: `${generationId}-${chunk.chunkIndex}`, workspaceId, fileId, generationId })));
  const deleteGeneration = jest.fn().mockResolvedValue(undefined);
  const deleteFile = jest.fn().mockResolvedValue(undefined);
  const upsertBatch = overrides.upsertBatch ?? jest.fn().mockResolvedValue(undefined);
  const reconcileGeneration = jest.fn().mockResolvedValue(undefined);
  const service = new KnowledgeProcessingService(
    prisma as never,
    { getById: jest.fn().mockResolvedValue({ id: "ws" }) } as never,
    { read: jest.fn().mockResolvedValue(Buffer.from("document")) } as never,
    { extract: overrides.extract ?? jest.fn().mockResolvedValue({ text: "hello" }) } as never,
    { chunk: overrides.chunked ?? jest.fn().mockReturnValue([{ chunkIndex: 0, text: "hello", wordCount: 1, tokenEstimate: 2 }]) } as never,
    { replace: persistedChunks, deleteGeneration, deleteFile } as never,
    { embedBatches: overrides.embedBatches ?? jest.fn(async function* (chunks: Array<Record<string, unknown>>) {
      yield chunks.map((chunk) => ({ workspaceId: "ws", fileId: "file", generationId: chunk.generationId, chunkIndex: chunk.chunkIndex, chunkId: chunk._id, vector: [0.1] }));
    }) } as never,
    { upsertBatch, reconcileGeneration, deleteGeneration, deleteFile } as never,
    { AI_REQUEST_TIMEOUT_MS: 30_000 } as never,
    { waitForGenerationDrain: overrides.waitForGenerationDrain ?? jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, prisma, chunks: { replace: persistedChunks, deleteGeneration, deleteFile }, vectors: { upsertBatch, reconcileGeneration, deleteGeneration, deleteFile }, getRow: () => row };
}

describe("KnowledgeProcessingService (mocked persistence/provider/vector boundaries)", () => {
  it("publishes a new generation only after MongoDB, embedding, and Qdrant work succeeds", async () => {
    const h = harness({ file: freshFile({ status: "READY", activeGenerationId: "old-generation", chunkCount: 7 }) });
    await expect(h.service.process("owner", "ws", "file")).resolves.toMatchObject({ status: "READY", chunkCount: 1 });
    expect(h.getRow()?.activeGenerationId).not.toBe("old-generation");
    expect(h.getRow()?.processingAttemptId).toBeNull();
    expect(h.vectors.upsertBatch).toHaveBeenCalledWith("ws", "file", h.getRow()?.activeGenerationId, expect.any(Array));
    expect(h.vectors.deleteGeneration).toHaveBeenCalledWith("ws", "file", "old-generation");
  });

  it("preserves the prior READY generation and cleans staging data after a partial reprocessing failure", async () => {
    const h = harness({
      file: freshFile({ status: "READY", activeGenerationId: "old-generation", chunkCount: 7 }),
      upsertBatch: jest.fn().mockRejectedValue(new Error("qdrant partial failure")),
    });
    await expect(h.service.process("owner", "ws", "file")).rejects.toMatchObject({ response: { code: "KNOWLEDGE_VECTOR_INDEXING_FAILED" } });
    expect(h.getRow()).toMatchObject({ status: "READY", activeGenerationId: "old-generation", chunkCount: 7, processingAttemptId: null });
    const stagingGeneration = h.chunks.replace.mock.calls[0]?.[2];
    expect(stagingGeneration).not.toBe("old-generation");
    expect(h.chunks.deleteGeneration).toHaveBeenCalledWith("ws", "file", stagingGeneration);
    expect(h.vectors.deleteGeneration).toHaveBeenCalledWith("ws", "file", stagingGeneration);
  });

  it("does not publish a new generation until the prior generation's active readers drain", async () => {
    const drainEntered = deferred();
    const allowPublish = deferred();
    const waitForGenerationDrain = jest.fn(async () => { drainEntered.resolve(); await allowPublish.promise; });
    const h = harness({ file: freshFile({ status: "READY", activeGenerationId: "old-generation", chunkCount: 2 }), waitForGenerationDrain });
    const processing = h.service.process("owner", "ws", "file");
    await drainEntered.promise;
    expect(h.getRow()).toMatchObject({ status: "EMBEDDING_PENDING", activeGenerationId: "old-generation" });
    allowPublish.resolve();
    await expect(processing).resolves.toMatchObject({ status: "READY" });
    expect(h.getRow()?.activeGenerationId).not.toBe("old-generation");
  });

  it("prevents stale attempt A from writing or changing attempt B after lease takeover", async () => {
    const extractionEntered = deferred();
    const releaseExtraction = deferred();
    const extraction = jest.fn().mockImplementationOnce(async () => {
      extractionEntered.resolve();
      await releaseExtraction.promise;
      return { text: "attempt-a" };
    }).mockResolvedValue({ text: "attempt-b" });
    const h = harness({ extract: extraction });
    const attemptA = h.service.process("owner", "ws", "file");
    await extractionEntered.promise;
    const attemptAId = h.getRow()?.processingAttemptId;
    h.getRow()!.updatedAt = new Date(Date.now() - 31 * 60 * 1000);
    await h.service.process("owner", "ws", "file");
    const attemptBId = h.getRow()?.activeGenerationId;
    releaseExtraction.resolve();
    await expect(attemptA).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_LIFECYCLE_BUSY" } });
    expect(attemptAId).not.toBe(attemptBId);
    expect(h.chunks.replace).toHaveBeenCalledTimes(1);
    expect(h.getRow()).toMatchObject({ status: "READY", activeGenerationId: attemptBId, processingAttemptId: null });
  });

  it("fences attempt A before heartbeat or Qdrant write when its provider batch returns late", async () => {
    const providerEntered = deferred();
    const releaseProvider = deferred();
    let providerAttempt = 0;
    const embedBatches = jest.fn(async function* (chunks: Array<Record<string, unknown>>) {
      providerAttempt += 1;
      if (providerAttempt === 1) {
        providerEntered.resolve();
        await releaseProvider.promise;
      }
      yield [{ workspaceId: "ws", fileId: "file", generationId: chunks[0]?.generationId, chunkIndex: 0, chunkId: "chunk", vector: [0.1] }];
    });
    const h = harness({ embedBatches });
    const oldAttempt = h.service.process("owner", "ws", "file");
    await providerEntered.promise;
    const oldAttemptId = h.getRow()?.processingAttemptId;
    h.getRow()!.updatedAt = new Date(Date.now() - 31 * 60 * 1000);
    await h.service.process("owner", "ws", "file");
    const published = h.getRow()?.activeGenerationId;
    releaseProvider.resolve();
    await expect(oldAttempt).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_LIFECYCLE_BUSY" } });
    expect(h.vectors.upsertBatch).toHaveBeenCalledTimes(1);
    expect(h.vectors.upsertBatch.mock.calls[0]?.[2]).toBe(published);
    expect(h.prisma.knowledgeFile.updateMany.mock.calls.some(([arg]) =>
      arg.where.processingAttemptId === oldAttemptId && "updatedAt" in arg.data,
    )).toBe(false);
    expect(h.getRow()).toMatchObject({ status: "READY", activeGenerationId: published, processingAttemptId: null });
  });

  it("coordinates deletion with a Qdrant write and blocks later batches after deletion wins", async () => {
    const firstWriteEntered = deferred();
    const releaseFirstWrite = deferred();
    const upsert = jest.fn().mockImplementationOnce(async () => {
      firstWriteEntered.resolve();
      await releaseFirstWrite.promise;
    });
    const embedBatches = jest.fn(async function* (chunks: Array<Record<string, unknown>>) {
      yield [{ workspaceId: "ws", fileId: "file", generationId: chunks[0]?.generationId, chunkIndex: 0, chunkId: "c0", vector: [0.1] }];
      yield [{ workspaceId: "ws", fileId: "file", generationId: chunks[0]?.generationId, chunkIndex: 1, chunkId: "c1", vector: [0.2] }];
    });
    const h = harness({ embedBatches, upsertBatch: upsert, chunked: jest.fn().mockReturnValue([
      { chunkIndex: 0, text: "first", wordCount: 1, tokenEstimate: 2 },
      { chunkIndex: 1, text: "second", wordCount: 1, tokenEstimate: 2 },
    ]) });
    const running = h.service.process("owner", "ws", "file");
    await firstWriteEntered.promise;
    const deleting = h.service.claimDeletion("owner", "ws", "file");
    releaseFirstWrite.resolve();
    const claim = await deleting;
    await h.service.cleanupDeletionArtifacts("ws", "file");
    await h.service.finishDeletion(claim);
    await expect(running).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_LIFECYCLE_BUSY" } });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(h.getRow()).toBeNull();
  });

  it("does not mark a newer attempt FAILED when an old extraction completes after takeover", async () => {
    const extractionEntered = deferred();
    const releaseExtraction = deferred();
    const extraction = jest.fn().mockImplementationOnce(async () => {
      extractionEntered.resolve();
      await releaseExtraction.promise;
      throw new BadRequestException({ code: "KNOWLEDGE_FILE_CORRUPT", message: "corrupt" });
    }).mockResolvedValue({ text: "new" });
    const h = harness({ extract: extraction });
    const old = h.service.process("owner", "ws", "file");
    await extractionEntered.promise;
    h.getRow()!.updatedAt = new Date(Date.now() - 31 * 60 * 1000);
    await h.service.process("owner", "ws", "file");
    const active = h.getRow()?.activeGenerationId;
    releaseExtraction.resolve();
    await expect(old).rejects.toMatchObject({ response: { code: "KNOWLEDGE_FILE_LIFECYCLE_BUSY" } });
    expect(h.getRow()).toMatchObject({ status: "READY", activeGenerationId: active, processingAttemptId: null });
  });

  it("keeps cleanup retryable after a workspace-scoped cleanup failure", async () => {
    const h = harness();
    h.vectors.deleteFile.mockRejectedValueOnce(new Error("Qdrant unavailable"));
    const claim = await h.service.claimDeletion("owner", "ws", "file");
    await expect(h.service.cleanupDeletionArtifacts("ws", "file")).rejects.toThrow("Qdrant unavailable");
    await h.service.releaseDeletion(claim);
    expect(h.getRow()).toMatchObject({ status: "DELETING", processingAttemptId: null });
    await expect(h.service.claimDeletion("owner", "ws", "file")).resolves.toMatchObject({ attemptId: expect.any(String) });
  });
});
