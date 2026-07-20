import { useState, type JSX, type ReactNode } from "react";
import { Sidebar, type SidebarNavItem } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { BreadcrumbItem } from "./Breadcrumbs";
import "./appShell.css";

export interface AppShellProps {
  navItems: SidebarNavItem[];
  breadcrumbs: BreadcrumbItem[];
  userName: string;
  /** Phase 3 Step 3 — the signed-in user's current avatar, or `null`/`undefined` to fall back to initials. */
  avatarUrl?: string | null;
  onSignOut: () => void;
  children: ReactNode;
}

/**
 * Reusable layout shell for authenticated/app screens. Collapses the
 * sidebar into an off-canvas drawer below the tablet breakpoint; see
 * appShell.css for the responsive rules (mobile / tablet / desktop /
 * ultra-wide).
 */
export function AppShell({
  navItems,
  breadcrumbs,
  userName,
  avatarUrl,
  onSignOut,
  children,
}: AppShellProps): JSX.Element {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="omni-app-shell">
      <Sidebar items={navItems} open={mobileSidebarOpen} onNavigate={() => setMobileSidebarOpen(false)} />
      {mobileSidebarOpen && (
        <button
          type="button"
          className="omni-app-shell__scrim"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <div className="omni-app-shell__body">
        <TopBar
          breadcrumbs={breadcrumbs}
          onToggleSidebar={() => setMobileSidebarOpen((prev) => !prev)}
          userName={userName}
          avatarUrl={avatarUrl}
          onSignOut={onSignOut}
        />
        <main className="omni-app-shell__main omni-motion-fade">{children}</main>
      </div>
    </div>
  );
}
