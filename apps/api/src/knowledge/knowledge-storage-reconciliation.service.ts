import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Logger } from "pino";
import { PrismaService } from "../prisma/prisma.service";
import { LOGGER } from "../config/config.constants";
import { KnowledgeStorageService } from "./knowledge-storage.service";

const RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * Recovers disk files left behind by failed uploads, interrupted deletes,
 * and Prisma cascades. Only aged, generated storage keys with no database
 * reference anywhere are eligible; ownership/deletion semantics stay in Prisma.
 */
@Injectable()
export class KnowledgeStorageReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: KnowledgeStorageService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), RECONCILIATION_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public for deterministic unit tests and an operational/manual repair hook. */
  async reconcile(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const staleKeys = await this.storage.listStaleFiles(
        new Date(Date.now() - ORPHAN_GRACE_PERIOD_MS),
      );
      if (staleKeys.length === 0) return 0;

      const referenced = await this.prisma.knowledgeFile.findMany({
        where: { storageKey: { in: staleKeys } },
        select: { storageKey: true },
      });
      const referencedKeys = new Set(referenced.map((row) => row.storageKey));
      let removed = 0;
      for (const storageKey of staleKeys) {
        if (referencedKeys.has(storageKey)) continue;
        await this.storage.delete(storageKey);
        removed += 1;
      }
      return removed;
    } catch (error) {
      // A later interval retries any files left after a partial failure.
      this.logger.warn({ err: error }, "Knowledge storage reconciliation failed");
      return 0;
    } finally {
      this.running = false;
    }
  }
}
