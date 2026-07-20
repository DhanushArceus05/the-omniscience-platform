import type { JSX } from "react";
import { NavLink } from "react-router-dom";

export interface SidebarNavItem {
  to: string;
  label: string;
  icon: string;
}

export interface SidebarProps {
  items: SidebarNavItem[];
  open: boolean;
  onNavigate?: () => void;
}

/**
 * Shared id linking the sidebar `<nav>` to the hamburger button's
 * `aria-controls` in TopBar, regardless of which layout (mobile drawer
 * or desktop collapse) is currently active.
 */
export const SIDEBAR_NAV_ID = "omni-primary-navigation";

const NAV_LIST_STYLE = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--omni-space-1)",
};

export function Sidebar({ items, open, onNavigate }: SidebarProps): JSX.Element {
  return (
    <nav
      id={SIDEBAR_NAV_ID}
      aria-label="Primary"
      className={`omni-app-sidebar${open ? " omni-app-sidebar--open" : ""}`}
    >
      <div style={{ padding: "0 var(--omni-space-2)", marginBottom: "var(--omni-space-4)" }}>
        <span style={{ fontWeight: "var(--omni-font-weight-semibold)", fontSize: "var(--omni-text-md)" }}>
          Omniscience
        </span>
      </div>
      <ul style={{ ...NAV_LIST_STYLE, listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end
              onClick={onNavigate}
              className={({ isActive }) =>
                `omni-app-sidebar__link${isActive ? " omni-app-sidebar__link--active" : ""}`
              }
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
