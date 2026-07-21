import { useCallback, useEffect, useState, type JSX } from "react";
import { Link } from "react-router-dom";
import { ApiClientError } from "@omniscience/sdk";
import type { Workspace } from "@omniscience/types";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@omniscience/ui";
import { useAuth } from "../../lib/auth/AuthContext";
import { getWorkspaceErrorMessage } from "./workspaceErrors";

type LoadState =
  | { phase: "loading" }
  | { phase: "not-found" }
  | { phase: "error"; message: string }
  | { phase: "ready"; workspace: Workspace };

const UNCONFIGURED_MESSAGE = "This workspace is unavailable right now — the API isn't configured.";

interface ModulePlaceholder {
  icon: string;
  title: string;
  description: string;
}

/**
 * Future workspace modules. Deliberately inert (no `onClick`, no route) —
 * Phase 3 Step 4 is UI scaffolding only, per `claude/CURRENT_PHASE.md`:
 * AI Assistant/Documents/Knowledge Base/Agents/Files/Tasks/Activity are
 * all later-phase functionality, not implemented here.
 */
const MODULE_PLACEHOLDERS: ModulePlaceholder[] = [
  { icon: "🤖", title: "AI Assistant", description: "Chat with an assistant scoped to this workspace." },
  { icon: "📄", title: "Documents", description: "Draft, store, and organize workspace documents." },
  { icon: "📚", title: "Knowledge Base", description: "Curated context your AI modules can draw on." },
  { icon: "🧩", title: "Agents", description: "Autonomous agents configured for this workspace." },
  { icon: "🗂️", title: "Files", description: "Upload and manage files shared across this workspace." },
  { icon: "✅", title: "Tasks", description: "Track work items and to-dos for this workspace." },
  { icon: "📈", title: "Activity", description: "A timeline of everything that's happened here." },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Phase 3 Step 4 — the real workspace detail experience, replacing the
 * `/app/workspace` 404 fallback. Renders at `/app/workspace/:workspaceId`
 * (see `WorkspacePage`).
 *
 * Loads via the existing `client.getWorkspace(accessToken, workspaceId)`
 * (Phase 3 Step 2) — the backend already scopes this to the caller's own
 * workspaces (`WorkspacesService.getById`), returning the identical
 * `WORKSPACE_NOT_FOUND` for a missing id or one owned by someone else.
 * This component treats that one `code` as its own "not found" state
 * (a dead end with a way back, not a retryable failure) and everything
 * else as a recoverable error with a "Try again" action — the same
 * split `WorkspaceDashboard` already uses for its own load failures.
 *
 * There is no "owner" field on `Workspace` (see `packages/types/src/
 * workspaces.ts`) because every workspace reachable through this page is
 * necessarily the signed-in caller's own — ownership is enforced
 * server-side, never by hiding a route. "Owner" here is therefore the
 * current session's `user`, not a value read off the workspace record.
 *
 * Deliberately NOT included (later Phase 3+ scope): the seven module
 * cards below are inert placeholders, and there's no rename/delete here
 * — the backend doesn't expose those endpoints yet.
 */
export function WorkspaceDetail({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { client, accessToken, user } = useAuth();
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  const loadWorkspace = useCallback(async () => {
    if (!client || !accessToken) {
      setState({ phase: "error", message: UNCONFIGURED_MESSAGE });
      return;
    }
    setState({ phase: "loading" });
    try {
      const workspace = await client.getWorkspace(accessToken, workspaceId);
      setState({ phase: "ready", workspace });
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "WORKSPACE_NOT_FOUND") {
        setState({ phase: "not-found" });
        return;
      }
      setState({ phase: "error", message: getWorkspaceErrorMessage(error) });
    }
  }, [client, accessToken, workspaceId]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  if (state.phase === "loading") {
    return <WorkspaceDetailSkeleton />;
  }

  if (state.phase === "not-found") {
    return (
      <EmptyState
        title="Workspace not found"
        description="It may have been removed, or the link may be incorrect."
        action={
          <Link to="/app" className="omni-button omni-button--primary omni-button--md">
            Back to Overview
          </Link>
        }
      />
    );
  }

  if (state.phase === "error") {
    return (
      <ErrorState
        title="Couldn't load this workspace"
        description={state.message}
        action={
          <div style={{ display: "flex", gap: "var(--omni-space-3)" }}>
            <button
              type="button"
              className="omni-button omni-button--secondary omni-button--md"
              onClick={() => void loadWorkspace()}
            >
              Try again
            </button>
            <Link to="/app" className="omni-button omni-button--ghost omni-button--md">
              Back to Overview
            </Link>
          </div>
        }
      />
    );
  }

  const { workspace } = state;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-6)" }}>
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "var(--omni-text-xl)" }}>{workspace.name}</h1>
            {workspace.description ? (
              <p style={{ margin: "var(--omni-space-2) 0 0", opacity: 0.8 }}>{workspace.description}</p>
            ) : (
              <p style={{ margin: "var(--omni-space-2) 0 0", opacity: 0.55, fontStyle: "italic" }}>
                No description provided.
              </p>
            )}
          </div>

          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "var(--omni-space-4)",
              margin: 0,
            }}
          >
            <div>
              <dt style={{ margin: 0, fontSize: "var(--omni-text-xs)", opacity: 0.6 }}>Owner</dt>
              <dd style={{ margin: "var(--omni-space-1) 0 0" }}>{user?.name ?? user?.email ?? "You"}</dd>
            </div>
            <div>
              <dt style={{ margin: 0, fontSize: "var(--omni-text-xs)", opacity: 0.6 }}>Created</dt>
              <dd style={{ margin: "var(--omni-space-1) 0 0" }}>{formatDate(workspace.createdAt)}</dd>
            </div>
            <div>
              <dt style={{ margin: 0, fontSize: "var(--omni-text-xs)", opacity: 0.6 }}>Last updated</dt>
              <dd style={{ margin: "var(--omni-space-1) 0 0" }}>{formatDate(workspace.updatedAt)}</dd>
            </div>
            <div>
              <dt style={{ margin: 0, fontSize: "var(--omni-text-xs)", opacity: 0.6 }}>Workspace ID</dt>
              <dd style={{ margin: "var(--omni-space-1) 0 0", fontFamily: "monospace", fontSize: "var(--omni-text-sm)" }}>
                {workspace.id}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      <div>
        <h2 style={{ margin: "0 0 var(--omni-space-4)", fontSize: "var(--omni-text-lg)" }}>Modules</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "var(--omni-space-4)",
          }}
          aria-label="Workspace modules"
        >
          {MODULE_PLACEHOLDERS.map((module) => (
            <Card key={module.title} className="omni-card--placeholder" aria-disabled="true">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "var(--omni-space-2)",
                }}
              >
                <span aria-hidden="true" style={{ fontSize: "var(--omni-text-lg)" }}>
                  {module.icon}
                </span>
                <Badge tone="neutral">Coming soon</Badge>
              </div>
              <p style={{ margin: "var(--omni-space-3) 0 0", fontWeight: 600 }}>{module.title}</p>
              <p style={{ margin: "var(--omni-space-1) 0 0", fontSize: "var(--omni-text-sm)", opacity: 0.7 }}>
                {module.description}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceDetailSkeleton(): JSX.Element {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-6)" }}
      aria-busy="true"
      aria-label="Loading workspace"
    >
      <Card>
        <Skeleton height="1.75rem" width="40%" />
        <div style={{ marginTop: "var(--omni-space-3)" }}>
          <Skeleton height="1rem" width="70%" />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "var(--omni-space-4)",
            marginTop: "var(--omni-space-6)",
          }}
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index}>
              <Skeleton height="0.75rem" width="60%" />
              <div style={{ marginTop: "var(--omni-space-2)" }}>
                <Skeleton height="1rem" width="85%" />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "var(--omni-space-4)",
        }}
      >
        {Array.from({ length: 7 }).map((_, index) => (
          <Card key={index}>
            <Skeleton height="1.25rem" width="1.25rem" circle />
            <div style={{ marginTop: "var(--omni-space-3)" }}>
              <Skeleton height="1rem" width="50%" />
            </div>
            <div style={{ marginTop: "var(--omni-space-2)" }}>
              <Skeleton height="0.75rem" width="90%" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
