import { KnowledgeReadLeaseService } from "./knowledge-read-lease.service";

describe("KnowledgeReadLeaseService (mocked PostgreSQL contract)", () => {
  const lease = { id: "lease-1", workspaceId: "ws-1", fileId: "file-1", generationId: "gen-1" };
  let service: KnowledgeReadLeaseService;
  let queryRaw: jest.Mock;
  let executeRaw: jest.Mock;

  beforeEach(() => {
    jest.useRealTimers();
    queryRaw = jest.fn().mockResolvedValue([{ id: lease.fileId }]);
    executeRaw = jest.fn().mockResolvedValue(1);
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({ $queryRaw: queryRaw, $executeRaw: executeRaw })),
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
    };
    service = new KnowledgeReadLeaseService(prisma as never, { AI_REQUEST_TIMEOUT_MS: 30_000 } as never);
  });

  it("acquires under a row lock and creates expiry using PostgreSQL time", async () => {
    const acquired = await service.acquire("owner-1", lease.workspaceId, lease.fileId, lease.generationId);
    expect(queryRaw.mock.calls[0]?.[0].join("")).toContain("FOR UPDATE");
    expect(queryRaw.mock.calls[0]?.[0].join("")).toContain('"status" = \'READY\'');
    const insertSql = executeRaw.mock.calls[0]?.[0].join("");
    expect(insertSql).toContain("clock_timestamp()");
    expect(insertSql).toContain("INTERVAL '1 millisecond'");
    expect(acquired).toMatchObject({ workspaceId: lease.workspaceId, fileId: lease.fileId, generationId: lease.generationId });
  });

  it("refuses to lease a file whose locked row is absent or no longer READY", async () => {
    queryRaw.mockResolvedValue([]);
    await expect(service.acquire("owner-1", lease.workspaceId, lease.fileId, lease.generationId)).resolves.toBeNull();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("uses PostgreSQL time for renewal and requires the same live lease and active generation", async () => {
    await expect(service.renew(lease)).resolves.toBe(true);
    const sql = executeRaw.mock.calls[0]?.[0].join("");
    expect(sql).toContain('l."id" =');
    expect(sql).toContain('l."workspaceId" =');
    expect(sql).toContain('l."fileId" =');
    expect(sql).toContain('l."generationId" =');
    expect(sql.match(/clock_timestamp\(\)/gu)).toHaveLength(2);
    expect(sql).toContain('f."activeGenerationId" = l."generationId"');
    executeRaw.mockResolvedValueOnce(0);
    await expect(service.renew(lease)).resolves.toBe(false);
  });

  it("validates expiry against PostgreSQL time rather than an API-host timestamp", async () => {
    await service.assertValid(lease);
    expect(queryRaw.mock.calls[0]?.[0].join("")).toContain('"expiresAt" > clock_timestamp()');
    expect(queryRaw.mock.calls[0]?.[0].join("")).not.toContain("Date");
    queryRaw.mockResolvedValueOnce([]);
    await expect(service.assertValid(lease)).rejects.toMatchObject({ response: { code: "KNOWLEDGE_READ_LEASE_EXPIRED" } });
  });

  it("keeps live readers during a bounded drain and cleans only DB-expired file leases", async () => {
    jest.useFakeTimers();
    queryRaw.mockResolvedValueOnce([{ count: 1n }]).mockResolvedValueOnce([{ count: 0n }]);
    let drained = false;
    const draining = service.waitForFileDrain(lease.workspaceId, lease.fileId).then(() => { drained = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(drained).toBe(false);
    const cleanupSql = executeRaw.mock.calls[0]?.[0].join("");
    expect(cleanupSql).toContain('"workspaceId" =');
    expect(cleanupSql).toContain('"fileId" =');
    expect(cleanupSql).toContain('"expiresAt" <= clock_timestamp()');
    await jest.advanceTimersByTimeAsync(200);
    await draining;
    expect(drained).toBe(true);
  });

  it("does not let API wall-clock changes alter a lease operation's database-time predicates", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2038-01-01T00:00:00Z"));
    await service.renew(lease);
    const first = executeRaw.mock.calls[0]?.[0].join("");
    jest.setSystemTime(new Date("1998-01-01T00:00:00Z"));
    await service.renew(lease);
    const second = executeRaw.mock.calls[1]?.[0].join("");
    expect(first).toBe(second);
    expect(first).toContain("clock_timestamp()");
  });

  it("fences account deletion before draining leases across all workspaces", async () => {
    queryRaw.mockResolvedValueOnce([{ id: "file-a", workspaceId: "ws-a" }, { id: "file-b", workspaceId: "ws-b" }]);
    await service.prepareOwnerDeletion("owner-1");
    expect(queryRaw.mock.calls[0]?.[0].join("")).toContain('"ownerId" =');
    expect(queryRaw.mock.calls[0]?.[0].join("")).toContain("FOR UPDATE");
    expect(executeRaw).toHaveBeenCalledTimes(2);
    for (const [template] of executeRaw.mock.calls) {
      expect(template.join("")).toContain("'DELETING'");
      expect(template.join("")).toContain('"processingAttemptId"');
      expect(template.join("")).toContain("clock_timestamp()");
    }
  });

  it("fences a workspace cascade and refuses to complete it while that workspace has an active reader", async () => {
    jest.useFakeTimers();
    queryRaw.mockResolvedValueOnce([{ id: "file-a", workspaceId: "ws-1" }]).mockResolvedValue([{ count: 1n }]);
    await service.prepareWorkspaceDeletion("ws-1");
    expect(executeRaw.mock.calls[0]?.[0].join("")).toContain('"workspaceId" =');
    expect(executeRaw.mock.calls[0]?.[0].join("")).toContain("'DELETING'");
    const draining = service.waitForWorkspaceDrain("ws-1");
    const rejected = expect(draining).rejects.toMatchObject({ response: { code: "KNOWLEDGE_READERS_DID_NOT_DRAIN" } });
    await jest.advanceTimersByTimeAsync(120_000);
    await rejected;
  });

  it("removes an expired crashed-process lease by PostgreSQL time before allowing an owner cascade", async () => {
    queryRaw.mockResolvedValueOnce([{ id: "file-a", workspaceId: "ws-a" }, { id: "file-b", workspaceId: "ws-b" }]).mockResolvedValueOnce([{ count: 0n }]);
    await service.prepareOwnerDeletion("owner-1");
    await expect(service.waitForOwnerDrain("owner-1")).resolves.toBeUndefined();
    const ownerCleanup = executeRaw.mock.calls.find(([template]) => template.join("").includes("USING \"knowledge_files\""))?.[0].join("");
    expect(ownerCleanup).toContain('f."ownerId" =');
    expect(ownerCleanup).toContain('l."expiresAt" <= clock_timestamp()');
  });

  it("cleans expired account leases with an owner-scoped join and checks remaining live leases by DB time", async () => {
    queryRaw.mockResolvedValueOnce([{ count: 0n }]);
    await service.waitForOwnerDrain("owner-1");
    expect(executeRaw.mock.calls[0]?.[0].join("")).toContain('f."ownerId" =');
    expect(executeRaw.mock.calls[0]?.[0].join("")).toContain('l."expiresAt" <= clock_timestamp()');
    expect(queryRaw.mock.calls[0]?.[0].join("")).toContain('f."ownerId" =');
    expect(queryRaw.mock.calls[0]?.[0].join("")).toContain('l."expiresAt" > clock_timestamp()');
  });

  it("keeps workspace cleanup scoped and times out instead of reporting deletion complete with active readers", async () => {
    jest.useFakeTimers();
    queryRaw.mockResolvedValue([{ count: 1n }]);
    let settled = false;
    const draining = service.waitForWorkspaceDrain("ws-1").finally(() => { settled = true; });
    const rejection = expect(draining).rejects.toMatchObject({ response: { code: "KNOWLEDGE_READERS_DID_NOT_DRAIN" } });
    await jest.advanceTimersByTimeAsync(120_000);
    await rejection;
    expect(settled).toBe(true);
    expect(executeRaw.mock.calls[0]?.[0].join("")).toContain('l."workspaceId" =');
    expect(executeRaw.mock.calls[0]?.[0].join("")).toContain('l."expiresAt" <= clock_timestamp()');
  });
});
