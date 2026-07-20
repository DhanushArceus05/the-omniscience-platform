import { useEffect, useState, type JSX, type ReactNode } from "react";
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
  /** The signed-in user's email, shown in the user menu's identity header. */
  userEmail?: string | null;
  onSignOut: () => void;
  children: ReactNode;
}

/** Matches the `appShell.css` tablet/desktop breakpoint: >1024px is "desktop". */
const DESKTOP_MEDIA_QUERY = "(min-width: 1025px)";

/**
 * Tracks whether the viewport currently matches the desktop breakpoint.
 * Falls back to `false` (mobile/tablet) in environments without
 * `matchMedia` (e.g. some test runners), and stays in sync with resizes.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleChange = (event: MediaQueryList | MediaQueryListEvent) => setIsDesktop(event.matches);
    handleChange(mql);

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handleChange);
      return () => mql.removeEventListener("change", handleChange);
    }
    // Safari < 14 fallback.
    mql.addListener(handleChange);
    return () => mql.removeListener(handleChange);
  }, []);

  return isDesktop;
}

/**
 * Reusable layout shell for authenticated/app screens.
 *
 * The primary navigation has two independent behaviors that share a single
 * hamburger button:
 *  - Mobile/tablet (<=1024px): an off-canvas drawer, closed by default.
 *  - Desktop (>1024px): a persistent sidebar, open by default, that the
 *    hamburger collapses/expands in place.
 *
 * See appShell.css for the responsive rules that realize each mode.
 */
export function AppShell({
  navItems,
  breadcrumbs,
  userName,
  avatarUrl,
  userEmail,
  onSignOut,
  children,
}: AppShellProps): JSX.Element {
  const isDesktop = useIsDesktop();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);

  const sidebarOpen = isDesktop ? desktopSidebarOpen : mobileSidebarOpen;

  const handleToggleSidebar = () => {
    if (isDesktop) {
      setDesktopSidebarOpen((prev) => !prev);
    } else {
      setMobileSidebarOpen((prev) => !prev);
    }
  };

  const handleNavigate = () => {
    // Only the mobile/tablet drawer closes on item selection; the
    // persistent desktop sidebar stays exactly as the user left it.
    if (!isDesktop) {
      setMobileSidebarOpen(false);
    }
  };

  return (
    <div className="omni-app-shell">
      <Sidebar items={navItems} open={sidebarOpen} onNavigate={handleNavigate} />
      {!isDesktop && mobileSidebarOpen && (
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
          sidebarOpen={sidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          userName={userName}
          avatarUrl={avatarUrl}
          userEmail={userEmail}
          onSignOut={onSignOut}
        />
        <main className="omni-app-shell__main omni-motion-fade">{children}</main>
      </div>
    </div>
  );
}
