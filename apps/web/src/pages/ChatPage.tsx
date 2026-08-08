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
 * Also reachable with a conversation id, `/app/workspace/:workspaceId/chat/:conversationId`
 * (Phase 6 Step 5 bugfix) — `ChatPanel` keeps this segment in sync with
 * whichever conversation is selected (via `navigate(..., { replace: true })`,
 * not a new history entry per message-send), so a hard browser refresh
 * restores the conversation that was open instead of always falling back
 * to "no conversation selected." `:conversationId` is read here and
 * passed down as the *initial* selection only — `ChatPanel` owns the
 * live value and updates the URL itself from then on.
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
  const { workspaceId, conversationId } = useParams<{ workspaceId: string; conversationId?: string }>();

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
      contained
    >
      <ChatPanel workspaceId={workspaceId} initialConversationId={conversationId ?? null} />
    </AppShell>
  );
}
