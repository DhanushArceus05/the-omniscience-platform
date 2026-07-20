import type { JSX } from "react";
import { AppShell } from "../layout/AppShell";
import { APP_NAV_ITEMS } from "../layout/navItems";
import { SystemStatusPanel } from "../features/system-status/SystemStatusPanel";
import { WorkspaceDashboard } from "../features/workspaces/WorkspaceDashboard";
import { useAuth } from "../lib/auth/AuthContext";

/**
 * Reachable at /app (behind ProtectedRoute as of Phase 3 Step 1).
 * Phase 3 Step 2 replaces the former placeholder with a real (if still
 * minimal) `WorkspaceDashboard`: list/create workspaces, scoped to the
 * caller's own. Further workspace features (a detail page; chats,
 * files, reports, memory, agents, analytics, timeline) remain out of
 * scope for later Phase 3 steps.
 */
export function AppShellPreviewPage(): JSX.Element {
  const { user, logout } = useAuth();

  return (
    <AppShell
      navItems={APP_NAV_ITEMS}
      breadcrumbs={[{ label: "Overview" }]}
      userName={user?.name ?? "Guest User"}
      avatarUrl={user?.avatarUrl}
      onSignOut={() => void logout()}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-6)" }}>
        <SystemStatusPanel />
        <WorkspaceDashboard />
      </div>
    </AppShell>
  );
}
