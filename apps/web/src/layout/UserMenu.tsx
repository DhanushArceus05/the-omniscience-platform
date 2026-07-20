import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Dropdown } from "@omniscience/ui";

export interface UserMenuProps {
  name: string;
  /** Phase 3 Step 3 — the user's current avatar, or `null`/`undefined` to fall back to initials. */
  avatarUrl?: string | null;
  onSignOut: () => void;
}

/**
 * Phase 3 Step 3 replaces the former disabled "Profile (coming soon)" /
 * "Settings (coming soon)" entries with a single, real "Settings" link
 * to `/app/settings` (per the locked scope: one settings experience,
 * not a separate profile page) plus "Sign out". Sign-out is wired to
 * `AuthContext.logout()` via `onSignOut` as of Phase 3 Step 1 — calling
 * it clears the session and flips `authStatus` to `"unauthenticated"`,
 * which `ProtectedRoute` reacts to by redirecting to `/login` on its
 * own; this component doesn't need to navigate itself for sign-out.
 */
export function UserMenu({ name, avatarUrl, onSignOut }: UserMenuProps): JSX.Element {
  const navigate = useNavigate();

  return (
    <Dropdown
      trigger={
        <span style={{ cursor: "pointer", display: "inline-flex" }}>
          <Avatar name={name} src={avatarUrl ?? undefined} size="sm" />
        </span>
      }
      items={[
        { key: "settings", label: "Settings", onSelect: () => navigate("/app/settings") },
        { key: "sign-out", label: "Sign out", onSelect: onSignOut },
      ]}
    />
  );
}
