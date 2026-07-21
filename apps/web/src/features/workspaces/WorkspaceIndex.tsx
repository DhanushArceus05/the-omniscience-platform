import { useCallback, useEffect, useState, type JSX } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button, EmptyState, ErrorState, Spinner } from "@omniscience/ui";
import { useAuth } from "../../lib/auth/AuthContext";
import { getWorkspaceErrorMessage } from "./workspaceErrors";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "empty" }
  | { phase: "redirect"; workspaceId: string };

const UNCONFIGURED_MESSAGE = "Workspaces are unavailable right now — the API isn't configured.";

/**
 * Reachable at `/app/workspace` (no id) — the sidebar's static "Workspace"
 * link target (see `navItems.ts`). There is no single "the" workspace
 * once a caller can own more than one (`WorkspaceDashboard` already lists
 * all of them at `/app`), so this is a thin landing spot rather than a
 * dashboard of its own:
 *
 * - At least one workspace exists → silently forward to the most
 *   recently created one (`GET /workspaces?limit=1`, already
 *   newest-first) at its real detail route, `/app/workspace/:id`.
 * - None exist yet → a real empty state pointing back to Overview, where
 *   "Create workspace" already lives (no create UI is duplicated here).
 *
 * This is what turns `/app/workspace` from a permanent 404 into a valid,
 * navigable route without inventing a "default workspace" concept the
 * backend doesn't have.
 */
export function WorkspaceIndex(): JSX.Element {
  const { client, accessToken } = useAuth();
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  const load = useCallback(async () => {
    if (!client || !accessToken) {
      setState({ phase: "error", message: UNCONFIGURED_MESSAGE });
      return;
    }
    setState({ phase: "loading" });
    try {
      const result = await client.listWorkspaces(accessToken, { limit: 1 });
      const first = result.workspaces[0];
      setState(first ? { phase: "redirect", workspaceId: first.id } : { phase: "empty" });
    } catch (error) {
      setState({ phase: "error", message: getWorkspaceErrorMessage(error) });
    }
  }, [client, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === "redirect") {
    return <Navigate to={`/app/workspace/${encodeURIComponent(state.workspaceId)}`} replace />;
  }

  if (state.phase === "loading") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "var(--omni-space-8)" }}>
        <Spinner size="lg" label="Loading your workspace" />
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <ErrorState
        title="Couldn't load your workspace"
        description={state.message}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      title="No workspaces yet"
      description="Create your first workspace from Overview to get started."
      action={
        <Link to="/app" className="omni-button omni-button--primary omni-button--md">
          Go to Overview
        </Link>
      }
    />
  );
}
