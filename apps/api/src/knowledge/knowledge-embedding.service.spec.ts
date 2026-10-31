import { ServiceUnavailableException } from "@nestjs/common";
import { aiDomainError } from "../ai/ai-provider.interface";
import { KnowledgeEmbeddingService } from "./knowledge-embedding.service";

describe("KnowledgeEmbeddingService (mocked OmniProvider)", () => {
  const env = { KNOWLEDGE_EMBEDDING_BATCH_SIZE: 2 } as never;
  const chunk = (index: number) => ({
    _id: `id${index}`, workspaceId: "ws", fileId: "file", generationId: "generation", chunkIndex: index,
    text: `text${index}`, wordCount: 1, tokenEstimate: 2, createdAt: new Date(), updatedAt: new Date(),
  });
  const vector = Array.from({ length: 1536 }, (_, index) => index / 1536);

  it("uses the fixed model, bounded native batches, and explicit response indexes", async () => {
    const embedBatch = jest.fn(async (_model: string, texts: readonly string[]) => texts.map((_, index) => ({ index, embedding: vector })).reverse());
    const service = new KnowledgeEmbeddingService({ getById: () => ({ embedBatch }) } as never, env);
    const output = await service.embed([chunk(0), chunk(1), chunk(2)]);
    expect(embedBatch).toHaveBeenCalledTimes(2);
    expect(embedBatch).toHaveBeenNthCalledWith(1, "text-embedding-3-small", ["text0", "text1"]);
    expect(output.map((row) => row.chunkIndex)).toEqual([0, 1, 2]);
    expect(output.every((row) => row.vector.length === 1536 && row.workspaceId === "ws" && row.fileId === "file")).toBe(true);
  });

  it("accepts empty input without calling the provider", async () => {
    const provider = { getById: jest.fn() };
    expect(await new KnowledgeEmbeddingService(provider as never, env).embed([])).toEqual([]);
    expect(provider.getById).not.toHaveBeenCalled();
  });

  it("rejects malformed vector response without associating it to a chunk", async () => {
    const service = new KnowledgeEmbeddingService({ getById: () => ({ embedBatch: async () => [{ index: 0, embedding: [1] }] }) } as never, env);
    await expect(service.embed([chunk(0)])).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    { response: [{ index: 0, embedding: vector }] },
    { response: [{ index: 0, embedding: vector }, { index: 0, embedding: vector }] },
  ])("rejects missing or duplicate explicit response indexes", async ({ response }) => {
    const service = new KnowledgeEmbeddingService({ getById: () => ({ embedBatch: async () => response }) } as never, env);
    await expect(service.embed([chunk(0), chunk(1)])).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("retries transient provider failures only within the bounded attempt count", async () => {
    const embedBatch = jest.fn().mockRejectedValueOnce(aiDomainError("PROVIDER_RATE_LIMITED", "limited"))
      .mockRejectedValueOnce(aiDomainError("PROVIDER_UNAVAILABLE", "offline"))
      .mockResolvedValue([{ index: 0, embedding: vector }]);
    const service = new KnowledgeEmbeddingService({ getById: () => ({ embedBatch }) } as never, env);
    await expect(service.embed([chunk(0)])).resolves.toHaveLength(1);
    expect(embedBatch).toHaveBeenCalledTimes(3);
  });

  it("does not retry permanent provider failures", async () => {
    const embedBatch = jest.fn().mockRejectedValue(aiDomainError("PROVIDER_AUTH_FAILED", "unauthorized"));
    const service = new KnowledgeEmbeddingService({ getById: () => ({ embedBatch }) } as never, env);
    await expect(service.embed([chunk(0)])).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(embedBatch).toHaveBeenCalledTimes(1);
  });

  it("embeds a search query through the same fixed OmniProvider model and validates dimensions", async () => {
    const embed = jest.fn().mockResolvedValue(vector);
    const service = new KnowledgeEmbeddingService({ getById: () => ({ embed }) } as never, env);
    await expect(service.embedQuery("question")).resolves.toEqual(vector);
    expect(embed).toHaveBeenCalledWith("text-embedding-3-small", "question");
    const invalid = new KnowledgeEmbeddingService({ getById: () => ({ embed: async () => [Number.NaN] }) } as never, env);
    await expect(invalid.embedQuery("question")).rejects.toMatchObject({ response: { code: "KNOWLEDGE_EMBEDDING_RESPONSE_INVALID" } });
  });
});
