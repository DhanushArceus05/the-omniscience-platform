import type { SidebarNavItem } from "./Sidebar";

/**
 * Shared across every top-level `/app/*` page (`AppShellPreviewPage`,
 * `AccountSettingsPage`) so the sidebar looks and behaves identically
 * regardless of which page rendered it — there's no shared layout/outlet
 * route yet (see `App.tsx`), so each top-level page builds its own
 * `<AppShell>`, but they must not each invent a slightly different nav
 * list. `/app/workspace` remains a placeholder — no workspace *detail*
 * route exists yet (out of Phase 3 Step 3's locked scope) — clicking it
 * still falls through to `NotFoundPage` until that step exists.
 */
export const APP_NAV_ITEMS: SidebarNavItem[] = [
  { to: "/app", label: "Overview", icon: "🏠" },
  { to: "/app/workspace", label: "Workspace", icon: "🗂️" },
  { to: "/app/settings", label: "Settings", icon: "⚙️" },
];
