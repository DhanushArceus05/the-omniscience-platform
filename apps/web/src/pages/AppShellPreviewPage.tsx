import type { JSX } from "react";
import { EmptyState } from "@omniscience/ui";
import { AppShell } from "../layout/AppShell";
import { SystemStatusPanel } from "../features/system-status/SystemStatusPanel";

const NAV_ITEMS = [
  { to: "/app", label: "Overview", icon: "🏠" },
  { to: "/app/workspace", label: "Workspace", icon: "🗂️" },
  { to: "/app/settings", label: "Settings", icon: "⚙️" },
];

/**
 * Reachable at /app. Demonstrates the Responsive App Shell deliverable
 * and keeps the Phase 0 health widget alive. Real dashboard/workspace
 * functionality is out of scope until Phase 3.
 */
export function AppShellPreviewPage(): JSX.Element {
  return (
    <AppShell navItems={NAV_ITEMS} breadcrumbs={[{ label: "Overview" }]}>
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
