import type { JSX } from "react";
import { useParams } from "react-router-dom";
import { AppShell } from "../layout/AppShell";
import { APP_NAV_ITEMS } from "../layout/navItems";
import { WorkspaceDetail } from "../features/workspaces/WorkspaceDetail";
import { WorkspaceIndex } from "../features/workspaces/WorkspaceIndex";
import { useAuth } from "../lib/auth/AuthContext";

/**
 * Phase 3 Step 4 — reachable at `/app/workspace` and
 * `/app/workspace/:workspaceId` (both behind `ProtectedRoute`, same as
 * every other `/app/*` page). Replaces the former placeholder that fell
 * through to `NotFoundPage` for both of those paths.
 *
 * One page, two bodies, exactly like `AppShellPreviewPage`/
 * `AccountSettingsPage` each build their own `<AppShell>`: with no id in
 * the URL this renders `WorkspaceIndex` (the sidebar's landing spot,
 * which forwards to a real workspace or shows an empty state); with an
 * id it renders `WorkspaceDetail`, which does the actual `getWorkspace`
 * fetch and premium dashboard rendering.
 */
export function WorkspacePage(): JSX.Element {
  const { user, logout } = useAuth();
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  return (
    <AppShell
      navItems={APP_NAV_ITEMS}
      breadcrumbs={[{ label: "Overview", to: "/app" }, { label: "Workspace" }]}
      userName={user?.name ?? "Guest User"}
      avatarUrl={user?.avatarUrl}
      userEmail={user?.email}
      onSignOut={() => void logout()}
    >
      {workspaceId ? <WorkspaceDetail workspaceId={workspaceId} /> : <WorkspaceIndex />}
    </AppShell>
  );
}
