/**
 * Request/response contracts for the Phase 3 Step 2 workspace endpoints:
 * create, bounded/paginated list, and get-one — all scoped to the
 * caller's own workspaces. There is no update or delete endpoint yet
 * (deliberately out of this step's scope), so no corresponding request
 * types exist here either.
 */
export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
}

export type CreateWorkspaceResponse = Workspace;

export interface ListWorkspacesQuery {
  /** Defaults to 20 server-side; capped at 50. */
  limit?: number;
  /** Opaque cursor from a previous `ListWorkspacesResponse.nextCursor`. */
  cursor?: string;
}

export interface ListWorkspacesResponse {
  /** Newest-first (by `createdAt`, tie-broken by `id`). */
  workspaces: Workspace[];
  /** `null` when there is no further page. */
  nextCursor: string | null;
}

export type GetWorkspaceResponse = Workspace;
