import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { AdaptiveBackground, useBodyScrollLock, useMediaQuery } from "@omniscience/ui";
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
  /**
   * Opt-in "fill the viewport" layout mode for pages that manage their
   * own internal scrolling (currently only Chat). Normal pages leave
   * this unset and keep the ordinary document-scrolls-the-page
   * behavior — `contained` instead pins `<main>` to the remaining
   * viewport height so a page like Chat can make the conversation list
   * and message thread each their own independent scroll container,
   * instead of the whole document scrolling underneath a fixed
   * composer.
   */
  contained?: boolean;
}

/** Matches the `appShell.css` tablet/desktop breakpoint: >1024px is "desktop". */
const DESKTOP_MEDIA_QUERY = "(min-width: 1025px)";

/**
 * Reusable layout shell for authenticated/app screens.
 *
 * The primary navigation has two independent behaviors that share a single
 * hamburger button:
 *  - Mobile/tablet (<=1024px): an off-canvas drawer, closed by default.
 *  - Desktop (>1024px): a persistent sidebar, open by default, that the
 *    hamburger collapses/expands in place.
 *
 * The mobile drawer additionally: locks background scroll while open,
 * closes on Escape (document-level, so it fires regardless of which
 * element inside the drawer has focus), moves focus onto the nav
 * surface when it opens, and returns focus to the hamburger button when
 * it closes (whether via Escape, the scrim, or a nav item selection).
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
  contained = false,
}: AppShellProps): JSX.Element {
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const wasMobileDrawerOpenRef = useRef(false);

  const sidebarOpen = isDesktop ? desktopSidebarOpen : mobileSidebarOpen;
  const mobileDrawerActive = !isDesktop && mobileSidebarOpen;

  useBodyScrollLock(mobileDrawerActive);

  // Escape closes the mobile drawer regardless of which element inside
  // it currently has focus — a plain onKeyDown on the drawer itself
  // would miss this if focus were ever outside it.
  useEffect(() => {
    if (!mobileDrawerActive) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileDrawerActive]);

  // Focus the nav surface when the mobile drawer opens; return focus to
  // the hamburger trigger when it closes (Escape, scrim click, or a nav
  // item navigating away all funnel through the same `mobileSidebarOpen`
  // state, so this one effect covers every close path).
  useEffect(() => {
    if (mobileDrawerActive) {
      sidebarRef.current?.focus();
      wasMobileDrawerOpenRef.current = true;
      return;
    }
    if (wasMobileDrawerOpenRef.current) {
      wasMobileDrawerOpenRef.current = false;
      menuButtonRef.current?.focus();
    }
  }, [mobileDrawerActive]);

  // Switching from mobile to desktop (or back) while the mobile drawer
  // happened to be open must not leave stale state — the desktop
  // sidebar's own open/closed state is independent.
  useEffect(() => {
    if (isDesktop) setMobileSidebarOpen(false);
  }, [isDesktop]);

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

  const shellClassName = `omni-app-shell${contained ? " omni-app-shell--contained" : ""}`;
  const mainClassName = `omni-app-shell__main omni-motion-fade${contained ? " omni-app-shell__main--contained" : ""}`;

  return (
    <div className={shellClassName}>
      {/*
       * Same ambient depth as the landing/auth pages, via the same
       * primitive — `.omni-background` is `position: fixed` at
       * `z-index: var(--omni-z-background)` (-1), so it paints behind
       * every surface in the app regardless of where it's mounted.
       * Deliberately *not* paired with any `backdrop-filter` surface
       * here (that combination is the documented cause of the
       * mouse-move flashing artifact — see claude/PROJECT_STATE.md and
       * `shouldRenderFrame`'s doc comment in AdaptiveBackground.tsx) —
       * `backdrop-filter` stays disabled on the sidebar/cards, so this
       * is safe. A low particle count and no neural-line connectors
       * keep it subtle enough not to compete with dashboard content,
       * and `AdaptiveBackground` itself already no-ops the animation
       * loop under `prefers-reduced-motion`.
       */}
      <AdaptiveBackground showNeuralLines={false} showNoise={false} particleCount={14} />
      <Sidebar ref={sidebarRef} items={navItems} open={sidebarOpen} onNavigate={handleNavigate} />
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
          menuButtonRef={menuButtonRef}
        />
        <main className={mainClassName}>{children}</main>
      </div>
    </div>
  );
}
