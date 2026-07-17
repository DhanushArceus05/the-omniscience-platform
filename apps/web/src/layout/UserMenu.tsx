import type { JSX } from "react";
import { Avatar, Dropdown } from "@omniscience/ui";

export interface UserMenuProps {
  name: string;
  onSignOut: () => void;
}

/**
 * Profile/Settings remain unbuilt (later Phase 3 scope). Sign-out is wired
 * to `AuthContext.logout()` via `onSignOut` as of Phase 3 Step 1 — calling
 * it clears the session and flips `authStatus` to `"unauthenticated"`,
 * which `ProtectedRoute` reacts to by redirecting to `/login` on its own;
 * this component doesn't need to navigate itself.
 */
export function UserMenu({ name, onSignOut }: UserMenuProps): JSX.Element {
  return (
    <Dropdown
      trigger={
        <span style={{ cursor: "pointer", display: "inline-flex" }}>
          <Avatar name={name} size="sm" />
        </span>
      }
      items={[
        { key: "profile", label: "Profile (coming soon)", disabled: true },
        { key: "settings", label: "Settings (coming soon)", disabled: true },
        { key: "sign-out", label: "Sign out", onSelect: onSignOut },
      ]}
    />
  );
}
