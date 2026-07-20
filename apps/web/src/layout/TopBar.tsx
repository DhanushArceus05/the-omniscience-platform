import type { JSX } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationButton } from "./NotificationButton";
import { UserMenu } from "./UserMenu";
import { SearchField } from "./SearchField";
import { SIDEBAR_NAV_ID } from "./Sidebar";

export interface TopBarProps {
  breadcrumbs: BreadcrumbItem[];
  /** Whether the primary navigation is currently open (mobile drawer shown, or desktop sidebar expanded). */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  userName: string;
  /** Phase 3 Step 3 — the signed-in user's current avatar, or `null`/`undefined` to fall back to initials. */
  avatarUrl?: string | null;
  /** The signed-in user's email, shown in the user menu's identity header. */
  userEmail?: string | null;
  onSignOut: () => void;
}

export function TopBar({
  breadcrumbs,
  sidebarOpen,
  onToggleSidebar,
  userName,
  avatarUrl,
  userEmail,
  onSignOut,
}: TopBarProps): JSX.Element {
  return (
    <header className="omni-app-topbar">
      <button
        type="button"
        className="omni-app-topbar__menu-button"
        aria-label={sidebarOpen ? "Collapse navigation" : "Expand navigation"}
        aria-expanded={sidebarOpen}
        aria-controls={SIDEBAR_NAV_ID}
        onClick={onToggleSidebar}
      >
        ☰
      </button>
      <div className="omni-app-topbar__breadcrumbs">
        <Breadcrumbs items={breadcrumbs} />
      </div>
      <div className="omni-app-topbar__search">
        <SearchField />
      </div>
      <div className="omni-app-topbar__actions">
        <ThemeToggle />
        <NotificationButton />
        <UserMenu name={userName} avatarUrl={avatarUrl} email={userEmail} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
