import type { JSX } from "react";
import { AppShell } from "../layout/AppShell";
import { SystemStatusPanel } from "../features/system-status/SystemStatusPanel";
import { WorkspaceDashboard } from "../features/workspaces/WorkspaceDashboard";
import { useAuth } from "../lib/auth/AuthContext";

const NAV_ITEMS = [
  { to: "/app", label: "Overview", icon: "🏠" },
  { to: "/app/workspace", label: "Workspace", icon: "🗂️" },
  { to: "/app/settings", label: "Settings", icon: "⚙️" },
];

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
      navItems={NAV_ITEMS}
      breadcrumbs={[{ label: "Overview" }]}
      userName={user?.name ?? "Guest User"}
      onSignOut={() => void logout()}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-6)" }}>
        <SystemStatusPanel />
        <WorkspaceDashboard />
      </div>
    </AppShell>
  );
}

