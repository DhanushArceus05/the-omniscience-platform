import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DEFAULT_WORKSPACE_LIST_LIMIT } from "@omniscience/schemas";
import type {
  CreateWorkspaceResponse,
  GetWorkspaceResponse,
  ListWorkspacesResponse,
  Workspace,
} from "@omniscience/types";
import { PrismaService } from "../prisma/prisma.service";

/** The minimal shape `toWorkspaceResponse` needs — satisfied by both a real Prisma row and the e2e fake. */
interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkspaceCursor {
  createdAt: string;
  id: string;
}

/**
 * Orchestrates the Phase 3 Step 2 workspace foundation: create, a
 * bounded/keyset-paginated list, and an ownership-checked get-one.
 *
 * Every operation is scoped exclusively to the caller's own workspaces
 * — `ownerId` always comes from the verified JWT payload
 * (`AccessTokenPayload.sub`) that `WorkspacesController` passes in,
 * never from request input. This mirrors the exact convention
 * `UsersService` (Phase 2 Step 6) already established for
 * self-scoped operations.
 *
 * There is no update or delete here — this step is explicitly locked to
 * create/list/get only (see `claude/CURRENT_PHASE.md`'s Phase 3 Step 2
 * section for the full list of what's deferred).
 */
@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, name: string, description?: string): Promise<CreateWorkspaceResponse> {
    const workspace = await this.prisma.workspace.create({
      data: { ownerId, name, description: description ?? null },
    });
    return toWorkspaceResponse(workspace);
  }

  /**
   * Newest-first, keyset (cursor) pagination — never an unbounded
   * query. `limit` is already capped by `listWorkspacesQuerySchema`
   * before it reaches here; this method applies the default when the
   * caller omits it entirely.
   *
   * The cursor is deliberately *not* Prisma's native `cursor: { id }`
   * mechanism (which would require the referenced row to exist and
   * could behave differently depending on whether that row happens to
   * belong to the caller — a subtle enumeration/consistency risk).
   * Instead the cursor encodes the last-seen `{ createdAt, id }` pair
   * as an opaque, self-contained value; the next page is computed with
   * an explicit keyset `WHERE` clause scoped to `ownerId`, so a cursor
   * can never reveal or depend on whether *any* particular workspace
   * exists — malformed input decodes to a plain `400`, nothing more.
   */
  async listForOwner(
    ownerId: string,
    params: { limit?: number; cursor?: string },
  ): Promise<ListWorkspacesResponse> {
    const take = params.limit ?? DEFAULT_WORKSPACE_LIST_LIMIT;
    const cursor = params.cursor ? decodeCursor(params.cursor) : null;

    const rows = await this.prisma.workspace.findMany({
      where: cursor
        ? {
            ownerId,
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : { ownerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const last = page[page.length - 1];

    return {
      workspaces: page.map(toWorkspaceResponse),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * Returns the caller's own workspace, or throws the identical
   * `404 WORKSPACE_NOT_FOUND` whether the id doesn't exist at all or
   * belongs to a different owner — same no-enumeration pattern
   * `AuthService.revokeSession` (Phase 2 Step 7) established for
   * sessions.
   */
  async getById(ownerId: string, workspaceId: string): Promise<GetWorkspaceResponse> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace || workspace.ownerId !== ownerId) {
      throw new NotFoundException({ code: "WORKSPACE_NOT_FOUND", message: "Workspace not found." });
    }
    return toWorkspaceResponse(workspace);
  }
}

function toWorkspaceResponse(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function encodeCursor(cursor: WorkspaceCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): WorkspaceCursor {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Partial<WorkspaceCursor>).createdAt === "string" &&
      typeof (parsed as Partial<WorkspaceCursor>).id === "string" &&
      !Number.isNaN(Date.parse((parsed as WorkspaceCursor).createdAt))
    ) {
      return parsed as WorkspaceCursor;
    }
  } catch {
    // fall through to the shared rejection below
  }
  throw new BadRequestException({ code: "INVALID_CURSOR", message: "The pagination cursor is invalid." });
}
