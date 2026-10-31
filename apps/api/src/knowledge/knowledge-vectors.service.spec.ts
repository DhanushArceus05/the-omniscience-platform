import { KnowledgeVectorsService, deterministicPointId } from "./knowledge-vectors.service";

describe("KnowledgeVectorsService (mocked Qdrant HTTP)", () => {
  const env = { QDRANT_URL: "http://qdrant.test", AI_REQUEST_TIMEOUT_MS: 1000 } as never;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (_input, init) => {
      const url = String(_input);
      if (url.endsWith("/points/scroll")) return Response.json({ result: { points: [], next_page_offset: null } });
      if (url.endsWith("/collections/omniscience_knowledge")) return Response.json({ result: { config: { params: { vectors: { size: 1536, distance: "Cosine" } } } } });
      if (url.endsWith("/index?wait=true")) return Response.json({ result: { status: "completed" } });
      if (url.endsWith("/points?wait=true")) return Response.json({ result: { status: "completed" } });
      if (url.endsWith("/points/delete?wait=true")) return Response.json({ result: { status: "completed" } });
      throw new Error(`Unexpected Qdrant call ${url} ${JSON.stringify(init)}`);
    });
  });
  afterEach(() => fetchMock.mockRestore());

  it("uses stable UUID point IDs and validates an existing compatible collection", async () => {
    const id = deterministicPointId("ws", "file", "gen-a", 0);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(id).toBe(deterministicPointId("ws", "file", "gen-a", 0));
    expect(id).not.toBe(deterministicPointId("ws", "file", "gen-b", 0));
    const service = new KnowledgeVectorsService(env);
    await service.ensureCollection();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/index?wait=true") && init?.method === "PUT")).toBe(true);
  });

  it("indexes batches idempotently and scopes file deletion by both IDs", async () => {
    const service = new KnowledgeVectorsService(env);
    await service.indexFile("ws-a", "file-a", "gen-a", [{
      workspaceId: "ws-a", fileId: "file-a", generationId: "gen-a", chunkId: "chunk", chunkIndex: 0, vector: Array(1536).fill(0.25),
    }]);
    const upsert = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/points?wait=true"));
    const payload = JSON.parse(String(upsert?.[1]?.body)) as { points: Array<{ id: string; payload: Record<string, unknown> }> };
    expect(payload.points[0]?.id).toBe(deterministicPointId("ws-a", "file-a", "gen-a", 0));
    expect(payload.points[0]?.payload).toEqual({ workspaceId: "ws-a", fileId: "file-a", generationId: "gen-a", chunkId: "chunk", chunkIndex: 0 });
    await service.deleteFile("ws-a", "file-a");
    await service.indexFile("ws-a", "file-a", "gen-a", [{
      workspaceId: "ws-a", fileId: "file-a", generationId: "gen-a", chunkId: "chunk", chunkIndex: 0, vector: Array(1536).fill(0.25),
    }]);
    const upserts = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/points?wait=true"));
    const repeatedPayload = JSON.parse(String(upserts[1]?.[1]?.body)) as { points: Array<{ id: string }> };
    expect(repeatedPayload.points[0]?.id).toBe(payload.points[0]?.id);
    const del = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/points/delete?wait=true"));
    expect(JSON.parse(String(del?.[1]?.body))).toEqual({ filter: { must: [
      { key: "workspaceId", match: { value: "ws-a" } }, { key: "fileId", match: { value: "file-a" } },
    ] } });
  });

  it("rejects incompatible existing collection configuration", async () => {
    fetchMock.mockImplementation(async () => Response.json({ result: { config: { params: { vectors: { size: 3, distance: "Cosine" } } } } }));
    await expect(new KnowledgeVectorsService(env).ensureCollection()).rejects.toMatchObject({ response: { code: "KNOWLEDGE_VECTOR_CONFIG_INVALID" } });
  });

  it("creates the collection only when absent and reconciles stale points after upsert", async () => {
    let collectionLookups = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/collections/omniscience_knowledge") && init?.method === "GET") {
        collectionLookups += 1;
        return collectionLookups === 1
          ? new Response(null, { status: 404 })
          : Response.json({ result: { config: { params: { vectors: { size: 1536, distance: "Cosine" } } } } });
      }
      if (url.endsWith("/points/scroll")) return Response.json({ result: { points: [{ id: "stale-point" }], next_page_offset: null } });
      if (url.endsWith("/points/delete?wait=true")) return Response.json({ result: { status: "completed" } });
      return Response.json({ result: { status: "completed" } });
    });
    const service = new KnowledgeVectorsService(env);
    await service.indexFile("ws", "file", "gen-a", []);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/collections/omniscience_knowledge") && init?.method === "PUT")).toBe(true);
    const staleDelete = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/points/delete?wait=true") &&
      JSON.parse(String(init?.body)).points);
    expect(JSON.parse(String(staleDelete?.[1]?.body))).toEqual({ points: ["stale-point"] });
  });

  it("uses only workspaceId for workspace deletion and rejects malformed vectors", async () => {
    const service = new KnowledgeVectorsService(env);
    await service.deleteWorkspace("ws-a");
    const deletion = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/points/delete?wait=true") && init?.body);
    expect(JSON.parse(String(deletion?.[1]?.body))).toEqual({ filter: { must: [{ key: "workspaceId", match: { value: "ws-a" } }] } });
    await expect(service.upsertBatch("ws-a", "file", "gen-a", [{ workspaceId: "ws-a", fileId: "file", generationId: "gen-a", chunkId: "c", chunkIndex: 0, vector: [1] }]))
      .rejects.toMatchObject({ response: { code: "KNOWLEDGE_VECTOR_INVALID" } });
  });

  it("searches with a mandatory workspace filter and returns validated source payloads", async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith("/collections/omniscience_knowledge")) return Response.json({ result: { config: { params: { vectors: { size: 1536, distance: "Cosine" } } } } });
      if (String(input).endsWith("/points/search")) return Response.json({ result: [{
        id: "point-id", score: 0.77, payload: { workspaceId: "ws-a", fileId: "file-a", generationId: "gen-a", chunkId: "chunk-a", chunkIndex: 3 },
      }] });
      return Response.json({ result: { status: "completed" } });
    });
    const service = new KnowledgeVectorsService(env);
    const results = await service.search("ws-a", Array(1536).fill(0.2), 8, ["gen-a"]);
    expect(results).toEqual([{ id: "point-id", score: 0.77, payload: { workspaceId: "ws-a", fileId: "file-a", generationId: "gen-a", chunkId: "chunk-a", chunkIndex: 3 } }]);
    const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/points/search"));
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      filter: { must: [
        { key: "workspaceId", match: { value: "ws-a" } },
        { key: "generationId", match: { any: ["gen-a"] } },
      ] },
      with_payload: ["workspaceId", "fileId", "generationId", "chunkId", "chunkIndex"],
    });
  });

  it("deletes a staging generation only within the specified workspace and file", async () => {
    const service = new KnowledgeVectorsService(env);
    await service.deleteGeneration("ws-a", "file-a", "gen-a");
    const deletion = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/points/delete?wait=true") && init?.body);
    expect(JSON.parse(String(deletion?.[1]?.body))).toEqual({ filter: { must: [
      { key: "workspaceId", match: { value: "ws-a" } },
      { key: "fileId", match: { value: "file-a" } },
      { key: "generationId", match: { value: "gen-a" } },
    ] } });
  });

  it("retries transient Qdrant failures a bounded number of times", async () => {
    let collectionCalls = 0;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/collections/omniscience_knowledge") && init?.method === "GET" && ++collectionCalls < 3) {
        return new Response(null, { status: 503 });
      }
      return Response.json({ result: { config: { params: { vectors: { size: 1536, distance: "Cosine" } } } } });
    });
    await new KnowledgeVectorsService(env).ensureCollection();
    expect(collectionCalls).toBe(3);
  });
});
