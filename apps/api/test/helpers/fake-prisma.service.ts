/**
 * Shared, in-memory stand-in for `PrismaService` used across every e2e
 * spec (`auth-registration.e2e-spec.ts`, `users-profile.e2e-spec.ts`,
 * `session-management.e2e-spec.ts`, and any future one). A single
 * source of truth for this fake means a capability added for one
 * feature's tests (e.g. Step 6's `update({ data: { name } })`) is
 * automatically available to every other e2e suite too, instead of each
 * file drifting its own slightly-different copy out of sync with what
 * `AuthService`/`UsersService` actually call.
 *
 * Implements only the surface real callers actually use — `findUnique`,
 * `create`, a partial `update` supporting every field Steps 2–6
 * currently update (`passwordHash` for Step 5's `resetPassword`/Step 6's
 * `changePassword`, `name` for Step 6's `updateProfile`), and `delete`
 * (Step 8's account deletion) — not a full Prisma Client.
 */
export interface FakeUserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  emailVerifiedAt: Date | null;
  /** Phase 3 Step 3 — mirrors `User.avatarStorageKey`; `null` until an avatar is uploaded. */
  avatarStorageKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Phase 3 Step 2 — mirrors the real `Workspace` Prisma model's shape. */
export interface FakeWorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export class FakePrismaService {
  private readonly users: FakeUserRow[] = [];
  private readonly workspaces: FakeWorkspaceRow[] = [];
  private workspaceSeq = 0;

  user = {
    findUnique: async ({
      where,
    }: {
      where: { email?: string; id?: string };
    }): Promise<FakeUserRow | null> =>
      this.users.find(
        (u) => (where.email !== undefined && u.email === where.email) || u.id === where.id,
      ) ?? null,
    create: async ({
      data,
    }: {
      data: { email: string; passwordHash: string; name: string; emailVerifiedAt: Date };
    }): Promise<FakeUserRow> => {
      if (this.users.some((u) => u.email === data.email)) {
        throw Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), {
          code: "P2002",
        });
      }
      const row: FakeUserRow = {
        id: `user_${this.users.length + 1}`,
        ...data,
        avatarStorageKey: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.users.push(row);
      return row;
    },
    // Partial update covering every field Steps 2–6 (and Step 3 of
    // Phase 3) currently write: `passwordHash` (Step 5 `resetPassword`,
    // Step 6 `changePassword`), `name` (Step 6 `updateProfile`), and
    // `avatarStorageKey` (Phase 3 Step 3 `uploadAvatar`/`deleteAvatar`,
    // which sets it to a new key or explicitly back to `null`).
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Pick<FakeUserRow, "name" | "passwordHash" | "avatarStorageKey">>;
    }): Promise<FakeUserRow> => {
      const row = this.users.find((u) => u.id === where.id);
      if (!row) {
        throw new Error("record not found");
      }
      Object.assign(row, data);
      row.updatedAt = new Date();
      return row;
    },
    // Step 8: hard-deletes the row, mirroring real Prisma's P2025 error
    // code when the target no longer exists (same shape `create`'s
    // P2002 mock already follows for its own not-found/conflict case).
    delete: async ({ where }: { where: { id: string } }): Promise<FakeUserRow> => {
      const index = this.users.findIndex((u) => u.id === where.id);
      if (index === -1) {
        throw Object.assign(new Error("Record to delete does not exist."), {
          code: "P2025",
        });
      }
      const [row] = this.users.splice(index, 1);
      return row as FakeUserRow;
    },
  };

  /**
   * Phase 3 Step 2 — implements only the surface `WorkspacesService`
   * actually calls: `create`, `findUnique` (by id, for the
   * ownership-checked get-one), and a keyset-aware `findMany` matching
   * the exact `{ ownerId, OR: [...] }` shape `WorkspacesService.
   * listForOwner` builds (newest-first by `createdAt`, tie-broken by
   * `id` descending — the same order the real Postgres query's
   * `orderBy` produces). IDs are zero-padded sequential strings so a
   * plain lexical comparison sorts identically to creation order, same
   * as a real `cuid()` does in practice.
   */
  workspace = {
    create: async ({
      data,
    }: {
      data: { name: string; description: string | null; ownerId: string };
    }): Promise<FakeWorkspaceRow> => {
      this.workspaceSeq += 1;
      const row: FakeWorkspaceRow = {
        id: `workspace_${String(this.workspaceSeq).padStart(10, "0")}`,
        name: data.name,
        description: data.description,
        ownerId: data.ownerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.workspaces.push(row);
      return row;
    },
    findUnique: async ({
      where,
    }: {
      where: { id: string };
    }): Promise<FakeWorkspaceRow | null> =>
      this.workspaces.find((w) => w.id === where.id) ?? null,
    findMany: async ({
      where,
      take,
    }: {
      where: {
        ownerId: string;
        OR?: Array<{ createdAt: Date | { lt: Date }; id?: { lt: string } }>;
      };
      take: number;
    }): Promise<FakeWorkspaceRow[]> => {
      let rows = this.workspaces.filter((w) => w.ownerId === where.ownerId);
      if (where.OR) {
        rows = rows.filter((w) =>
          (where.OR ?? []).some((cond) => {
            if (cond.createdAt instanceof Date) {
              // { createdAt: eq, id: { lt } } branch
              return (
                w.createdAt.getTime() === cond.createdAt.getTime() &&
                cond.id !== undefined &&
                w.id < cond.id.lt
              );
            }
            // { createdAt: { lt } } branch
            return w.createdAt.getTime() < cond.createdAt.lt.getTime();
          }),
        );
      }
      const sorted = rows.slice().sort((a, b) => {
        const diff = b.createdAt.getTime() - a.createdAt.getTime();
        if (diff !== 0) return diff;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      });
      return sorted.slice(0, take);
    },
  };

  async onModuleInit(): Promise<void> {
    // no-op
  }

  async onModuleDestroy(): Promise<void> {
    // no-op
  }
}
