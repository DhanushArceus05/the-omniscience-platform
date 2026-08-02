import type { JSX } from "react";
import { useParams } from "react-router-dom";
import { AppShell } from "../layout/AppShell";
import { APP_NAV_ITEMS } from "../layout/navItems";
import { ChatPanel } from "../features/chat/ChatPanel";
import { useAuth } from "../lib/auth/AuthContext";

/**
 * Phase 6 Step 3 — reachable at `/app/workspace/:workspaceId/chat`
 * (behind `ProtectedRoute`, same as every other `/app/*` page). This is
 * a dedicated route rather than a panel embedded in `WorkspaceDetail`:
 * it gets its own back/forward history entry and is deep-linkable, and
 * a full-height chat layout doesn't have to compete with
 * `WorkspaceDetail`'s existing module-grid layout on the same page.
 *
 * Deliberately workspace-scoped only — there is no global `/app/chat`
 * route and no "Chat" entry in `APP_NAV_ITEMS`; the only way in is via
 * the "AI Assistant" entry point on that workspace's own
 * `WorkspaceDetail` page, matching the approved scope for this step.
 *
 * `workspaceId` comes from the route param, exactly like
 * `WorkspacePage` — ownership of the workspace (and, in turn, every
 * conversation inside it) is still verified entirely server-side by
 * the existing Phase 6 backend, never by anything client-side here.
 */
export function ChatPage(): JSX.Element {
  const { user, logout } = useAuth();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  if (!workspaceId) {
    // Unreachable through the route defined in App.tsx (`:workspaceId`
    // is required), but keeps this component total rather than
    // asserting a non-null value into `ChatPanel`.
    return (
      <AppShell
        navItems={APP_NAV_ITEMS}
        breadcrumbs={[{ label: "Overview", to: "/app" }, { label: "Chat" }]}
        userName={user?.name ?? "Guest User"}
        avatarUrl={user?.avatarUrl}
        userEmail={user?.email}
        onSignOut={() => void logout()}
      >
        <p>No workspace was specified.</p>
      </AppShell>
    );
  }

  return (
    <AppShell
      navItems={APP_NAV_ITEMS}
      breadcrumbs={[
        { label: "Overview", to: "/app" },
        { label: "Workspace", to: `/app/workspace/${encodeURIComponent(workspaceId)}` },
        { label: "Chat" },
      ]}
      userName={user?.name ?? "Guest User"}
      avatarUrl={user?.avatarUrl}
      userEmail={user?.email}
      onSignOut={() => void logout()}
    >
      <ChatPanel workspaceId={workspaceId} />
    </AppShell>
  );
}
