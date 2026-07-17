import type { JSX } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationButton } from "./NotificationButton";
import { UserMenu } from "./UserMenu";
import { SearchField } from "./SearchField";

export interface TopBarProps {
  breadcrumbs: BreadcrumbItem[];
  onToggleSidebar: () => void;
  userName: string;
  onSignOut: () => void;
}

export function TopBar({ breadcrumbs, onToggleSidebar, userName, onSignOut }: TopBarProps): JSX.Element {
  return (
    <header className="omni-app-topbar">
      <button
        type="button"
        className="omni-app-topbar__menu-button"
        aria-label="Toggle navigation"
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
        <UserMenu name={userName} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
