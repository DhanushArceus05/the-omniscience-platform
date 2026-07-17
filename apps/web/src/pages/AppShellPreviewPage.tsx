import type { JSX } from "react";
import { EmptyState } from "@omniscience/ui";
import { AppShell } from "../layout/AppShell";
import { SystemStatusPanel } from "../features/system-status/SystemStatusPanel";
import { useAuth } from "../lib/auth/AuthContext";

const NAV_ITEMS = [
  { to: "/app", label: "Overview", icon: "🏠" },
  { to: "/app/workspace", label: "Workspace", icon: "🗂️" },
  { to: "/app/settings", label: "Settings", icon: "⚙️" },
];

/**
 * Reachable at /app (behind ProtectedRoute as of Phase 3 Step 1). Demonstrates
 * the Responsive App Shell deliverable and keeps the Phase 0 health widget
 * alive. Real dashboard/workspace functionality is out of scope until later
 * Phase 3 steps.
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
        <EmptyState
          title="Dashboard arrives in Phase 3"
          description="This shell is the reusable foundation — workspace and dashboard functionality is built on top of it next."
        />
      </div>
    </AppShell>
  );
}
