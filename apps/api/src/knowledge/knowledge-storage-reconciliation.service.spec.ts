import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Env } from "@omniscience/config";
import { InternalServerErrorException } from "@nestjs/common";
import type { Logger } from "pino";
import { PrismaService } from "../prisma/prisma.service";
import { KnowledgeStorageService } from "./knowledge-storage.service";
import { KnowledgeStorageReconciliationService } from "./knowledge-storage-reconciliation.service";

describe("KnowledgeStorageReconciliationService", () => {
  let storageDir: string;
  let storage: KnowledgeStorageService;
  const logger = { warn: jest.fn() } as unknown as Logger;

  beforeEach(async () => {
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "omniscience-knowledge-reconcile-"));
    storage = new KnowledgeStorageService({
      KNOWLEDGE_STORAGE_DIR: storageDir,
      KNOWLEDGE_FILE_SIZE_LIMIT_MB: 1,
    } as unknown as Env);
  });

  afterEach(async () => {
    await fs.rm(storageDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it("removes only aged generated files absent from every Knowledge metadata row", async () => {
    const content = Buffer.from("orphan fixture");
    const referenced = await storage.save({ buffer: content, originalname: "a.txt", mimetype: "text/plain", size: content.length });
    const orphan = await storage.save({ buffer: content, originalname: "b.txt", mimetype: "text/plain", size: content.length });
    storage.markCommitted(referenced.storageKey);
    storage.markCommitted(orphan.storageKey);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fs.utimes(path.join(storageDir, referenced.storageKey), old, old);
    await fs.utimes(path.join(storageDir, orphan.storageKey), old, old);
    const prisma = {
      knowledgeFile: { findMany: jest.fn().mockResolvedValue([{ storageKey: referenced.storageKey }]) },
    } as unknown as PrismaService;
    const service = new KnowledgeStorageReconciliationService(prisma, storage, logger);

    await expect(service.reconcile()).resolves.toBe(1);
    await expect(fs.readFile(path.join(storageDir, referenced.storageKey))).resolves.toEqual(content);
    await expect(fs.readFile(path.join(storageDir, orphan.storageKey))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves files untouched and retries on the next run after a database failure", async () => {
    const content = Buffer.from("retry fixture");
    const orphan = await storage.save({ buffer: content, originalname: "retry.txt", mimetype: "text/plain", size: content.length });
    storage.markCommitted(orphan.storageKey);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fs.utimes(path.join(storageDir, orphan.storageKey), old, old);
    const findMany = jest.fn().mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValueOnce([]);
    const prisma = { knowledgeFile: { findMany } } as unknown as PrismaService;
    const service = new KnowledgeStorageReconciliationService(prisma, storage, logger);

    await expect(service.reconcile()).resolves.toBe(0);
    await expect(fs.readFile(path.join(storageDir, orphan.storageKey))).resolves.toEqual(content);
    await expect(service.reconcile()).resolves.toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    await expect(fs.readFile(path.join(storageDir, orphan.storageKey))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("excludes in-flight uploads from reconciliation", async () => {
    const content = Buffer.from("pending fixture");
    const pending = await storage.save({ buffer: content, originalname: "pending.txt", mimetype: "text/plain", size: content.length });
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fs.utimes(path.join(storageDir, pending.storageKey), old, old);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { knowledgeFile: { findMany } } as unknown as PrismaService;
    const service = new KnowledgeStorageReconciliationService(prisma, storage, logger);

    await expect(service.reconcile()).resolves.toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    await expect(fs.readFile(path.join(storageDir, pending.storageKey))).resolves.toEqual(content);
  });

  it("retries physical deletion after a partial cleanup failure", async () => {
    const content = Buffer.from("delete retry fixture");
    const orphan = await storage.save({ buffer: content, originalname: "retry-delete.txt", mimetype: "text/plain", size: content.length });
    storage.markCommitted(orphan.storageKey);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fs.utimes(path.join(storageDir, orphan.storageKey), old, old);
    jest.spyOn(storage, "delete").mockRejectedValueOnce(new InternalServerErrorException());
    const prisma = { knowledgeFile: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
    const service = new KnowledgeStorageReconciliationService(prisma, storage, logger);

    await expect(service.reconcile()).resolves.toBe(0);
    await expect(fs.readFile(path.join(storageDir, orphan.storageKey))).resolves.toEqual(content);
    await expect(service.reconcile()).resolves.toBe(1);
    await expect(fs.readFile(path.join(storageDir, orphan.storageKey))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
