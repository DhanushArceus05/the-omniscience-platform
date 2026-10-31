import { randomUUID } from "node:crypto";
import { ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import type { Env } from "@omniscience/config";
import { ENV } from "../config/config.constants";
import { PrismaService } from "../prisma/prisma.service";

const HEARTBEAT_MS = 30_000;
const DRAIN_TIMEOUT_MS = 2 * 60_000;

export interface KnowledgeReadLease {
  id: string;
  workspaceId: string;
  fileId: string;
  generationId: string;
}

interface KnowledgeFileLockRow { id: string; workspaceId: string }

/** PostgreSQL-backed read fencing shared by all API instances. Lease time is always evaluated by PostgreSQL. */
@Injectable()
export class KnowledgeReadLeaseService {
  private readonly leaseTtlMs: number;
  constructor(private readonly prisma: PrismaService, @Inject(ENV) env: Env) {
    this.leaseTtlMs = Math.max(5 * 60_000, env.AI_REQUEST_TIMEOUT_MS + 15_000);
  }

  async acquire(ownerId: string, workspaceId: string, fileId: string, generationId: string): Promise<KnowledgeReadLease | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "knowledge_files"
        WHERE "id" = ${fileId} AND "workspaceId" = ${workspaceId} AND "ownerId" = ${ownerId}
          AND "status" = 'READY' AND "activeGenerationId" = ${generationId}
        FOR UPDATE
      `;
      if (!rows.length) return null;
      const lease = { id: randomUUID(), workspaceId, fileId, generationId };
      const inserted = await tx.$executeRaw`
        INSERT INTO "knowledge_file_read_leases" ("id", "workspaceId", "fileId", "generationId", "expiresAt")
        VALUES (${lease.id}, ${workspaceId}, ${fileId}, ${generationId}, clock_timestamp() + (${this.leaseTtlMs} * INTERVAL '1 millisecond'))
      `;
      if (inserted !== 1) throw new ServiceUnavailableException({ code: "KNOWLEDGE_READ_LEASE_UNAVAILABLE", message: "Knowledge context is temporarily unavailable." });
      return lease;
    });
  }

  async renew(lease: KnowledgeReadLease): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      UPDATE "knowledge_file_read_leases" AS l
      SET "expiresAt" = clock_timestamp() + (${this.leaseTtlMs} * INTERVAL '1 millisecond')
      WHERE l."id" = ${lease.id} AND l."workspaceId" = ${lease.workspaceId} AND l."fileId" = ${lease.fileId}
        AND l."generationId" = ${lease.generationId} AND l."expiresAt" > clock_timestamp()
        AND EXISTS (
          SELECT 1 FROM "knowledge_files" AS f
          WHERE f."id" = l."fileId" AND f."workspaceId" = l."workspaceId"
            AND f."activeGenerationId" = l."generationId"
            AND f."status" IN ('READY', 'PROCESSING', 'EXTRACTED', 'EMBEDDING_PENDING', 'DELETING')
        )
    `;
    return count === 1;
  }

  async assertValid(lease: KnowledgeReadLease): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "knowledge_file_read_leases"
      WHERE "id" = ${lease.id} AND "workspaceId" = ${lease.workspaceId} AND "fileId" = ${lease.fileId}
        AND "generationId" = ${lease.generationId} AND "expiresAt" > clock_timestamp()
    `;
    if (rows.length !== 1) throw new ConflictException({ code: "KNOWLEDGE_READ_LEASE_EXPIRED", message: "Knowledge context is no longer available. Please retry." });
  }

  async release(lease: KnowledgeReadLease): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "knowledge_file_read_leases"
      WHERE "id" = ${lease.id} AND "workspaceId" = ${lease.workspaceId} AND "fileId" = ${lease.fileId} AND "generationId" = ${lease.generationId}
    `;
  }

  async releaseMany(leases: readonly KnowledgeReadLease[]): Promise<void> { await Promise.all(leases.map((lease) => this.release(lease))); }

  async hasLive(workspaceId: string, fileId: string, generationId: string): Promise<boolean> {
    await this.deleteExpiredForFile(workspaceId, fileId, generationId);
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS "count" FROM "knowledge_file_read_leases"
      WHERE "workspaceId" = ${workspaceId} AND "fileId" = ${fileId} AND "generationId" = ${generationId}
        AND "expiresAt" > clock_timestamp()
    `;
    return Number(rows[0]?.count ?? 0) > 0;
  }

  /** Mark all files DELETING before account deletion, so no new leases or processors can start during the drain. */
  async prepareOwnerDeletion(ownerId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const files = await tx.$queryRaw<KnowledgeFileLockRow[]>`
        SELECT "id", "workspaceId" FROM "knowledge_files" WHERE "ownerId" = ${ownerId} FOR UPDATE
      `;
      for (const file of files) {
        await tx.$executeRaw`
          UPDATE "knowledge_files" SET "status" = 'DELETING', "processingAttemptId" = ${randomUUID()}, "updatedAt" = clock_timestamp()
          WHERE "id" = ${file.id} AND "workspaceId" = ${file.workspaceId} AND "ownerId" = ${ownerId}
        `;
      }
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  /** Same protocol for an explicit workspace cascade if/when that route is introduced. */
  async prepareWorkspaceDeletion(workspaceId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const files = await tx.$queryRaw<KnowledgeFileLockRow[]>`
        SELECT "id", "workspaceId" FROM "knowledge_files" WHERE "workspaceId" = ${workspaceId} FOR UPDATE
      `;
      for (const file of files) {
        await tx.$executeRaw`
          UPDATE "knowledge_files" SET "status" = 'DELETING', "processingAttemptId" = ${randomUUID()}, "updatedAt" = clock_timestamp()
          WHERE "id" = ${file.id} AND "workspaceId" = ${workspaceId}
        `;
      }
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  async waitForOwnerDrain(ownerId: string): Promise<void> { await this.waitForScopeDrain(ownerId); }
  async waitForWorkspaceDrain(workspaceId: string): Promise<void> { await this.waitForScopeDrain(undefined, workspaceId); }

  async waitForFileDrain(workspaceId: string, fileId: string): Promise<void> { await this.waitForDrain(workspaceId, fileId); }
  async waitForGenerationDrain(workspaceId: string, fileId: string, generationId: string): Promise<void> { await this.waitForDrain(workspaceId, fileId, generationId); }

  private async deleteExpiredForFile(workspaceId: string, fileId: string, generationId?: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "knowledge_file_read_leases"
      WHERE "workspaceId" = ${workspaceId} AND "fileId" = ${fileId}
        AND (${generationId ?? null}::text IS NULL OR "generationId" = ${generationId ?? null})
        AND "expiresAt" <= clock_timestamp()
    `;
  }

  private async waitForDrain(workspaceId: string, fileId: string, generationId?: string): Promise<void> {
    await this.waitLoop(async () => {
      await this.deleteExpiredForFile(workspaceId, fileId, generationId);
      const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS "count" FROM "knowledge_file_read_leases"
        WHERE "workspaceId" = ${workspaceId} AND "fileId" = ${fileId}
          AND (${generationId ?? null}::text IS NULL OR "generationId" = ${generationId ?? null})
          AND "expiresAt" > clock_timestamp()
      `;
      return Number(rows[0]?.count ?? 0);
    });
  }

  private async waitForScopeDrain(ownerId?: string, workspaceId?: string): Promise<void> {
    await this.waitLoop(async () => {
      if (ownerId) {
        await this.prisma.$executeRaw`
          DELETE FROM "knowledge_file_read_leases" AS l USING "knowledge_files" AS f
          WHERE f."id" = l."fileId" AND f."ownerId" = ${ownerId} AND l."expiresAt" <= clock_timestamp()
        `;
      } else if (workspaceId) {
        await this.prisma.$executeRaw`
          DELETE FROM "knowledge_file_read_leases" AS l
          WHERE l."workspaceId" = ${workspaceId} AND l."expiresAt" <= clock_timestamp()
        `;
      }
      const rows = ownerId
        ? await this.prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*) AS "count" FROM "knowledge_file_read_leases" AS l
            JOIN "knowledge_files" AS f ON f."id" = l."fileId"
            WHERE f."ownerId" = ${ownerId} AND l."expiresAt" > clock_timestamp()
          `
        : await this.prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*) AS "count" FROM "knowledge_file_read_leases"
            WHERE "workspaceId" = ${workspaceId} AND "expiresAt" > clock_timestamp()
          `;
      return Number(rows[0]?.count ?? 0);
    });
  }

  private async waitLoop(liveCount: () => Promise<number>): Promise<void> {
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!(await liveCount())) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new ServiceUnavailableException({ code: "KNOWLEDGE_READERS_DID_NOT_DRAIN", message: "Knowledge files are still being used by active responses. Please retry deletion." });
  }

  heartbeatInterval(): number { return HEARTBEAT_MS; }
}
