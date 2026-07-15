/**
 * Shared, in-memory stand-in for `PrismaService` used across every e2e
 * spec (`auth-registration.e2e-spec.ts`, `users-profile.e2e-spec.ts`,
 * and any future one). A single source of truth for this fake means a
 * capability added for one feature's tests (e.g. Step 6's `update({
 * data: { name } })`) is automatically available to every other e2e
 * suite too, instead of each file drifting its own slightly-different
 * copy out of sync with what `AuthService`/`UsersService` actually call.
 *
 * Implements only the surface real callers actually use — `findUnique`,
 * `create`, and a partial `update` supporting every field Steps 2–6
 * currently update (`passwordHash` for Step 5's `resetPassword`/Step 6's
 * `changePassword`, `name` for Step 6's `updateProfile`) — not a full
 * Prisma Client.
 */
export interface FakeUserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class FakePrismaService {
  private readonly users: FakeUserRow[] = [];

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
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.users.push(row);
      return row;
    },
    // Partial update covering every field Steps 2–6 currently write:
    // `passwordHash` (Step 5 `resetPassword`, Step 6 `changePassword`)
    // and `name` (Step 6 `updateProfile`).
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Pick<FakeUserRow, "name" | "passwordHash">>;
    }): Promise<FakeUserRow> => {
      const row = this.users.find((u) => u.id === where.id);
      if (!row) {
        throw new Error("record not found");
      }
      Object.assign(row, data);
      row.updatedAt = new Date();
      return row;
    },
  };

  async onModuleInit(): Promise<void> {
    // no-op
  }

  async onModuleDestroy(): Promise<void> {
    // no-op
  }
}
