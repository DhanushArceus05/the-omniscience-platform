import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Dropdown } from "@omniscience/ui";

export interface UserMenuProps {
  name: string;
  /** Phase 3 Step 3 — the user's current avatar, or `null`/`undefined` to fall back to initials. */
  avatarUrl?: string | null;
  /**
   * The signed-in user's email. Optional (rather than required) purely so
   * existing callers/tests that only pass `name` keep compiling — every
   * real `/app/*` page has it available via `AuthContext.user.email`.
   */
  email?: string | null;
  onSignOut: () => void;
}

/**
 * Phase 3 Step 3 replaced the former disabled "Profile (coming soon)" /
 * "Settings (coming soon)" entries with a real "Settings" link. This pass
 * (frontend UX polish) adds the trigger's visible name (desktop only —
 * see `.omni-user-menu__name` in `appShell.css`, which hides it below the
 * tablet breakpoint so mobile keeps the avatar-only trigger) and expands
 * the menu with an identity header (Display Name + Email — presentational
 * only, not a real menu item) and a "Profile" entry.
 *
 * "Profile" and "Settings" intentionally both navigate to `/app/settings`:
 * the locked scope from Phase 3 Step 3 is one settings experience with
 * tabs (see `SettingsExperience`), not a separate `/app/profile` route,
 * and its first tab (open by default) *is* the profile editor. Adding a
 * real second route here would duplicate that page rather than reuse it.
 *
 * Sign-out (labeled "Logout" in the menu) is wired to `AuthContext.logout()`
 * via `onSignOut` as of Phase 3 Step 1 — calling it clears the session and
 * flips `authStatus` to `"unauthenticated"`, which `ProtectedRoute` reacts
 * to by redirecting to `/login` on its own; this component doesn't need to
 * navigate itself for sign-out.
 */
export function UserMenu({ name, avatarUrl, email, onSignOut }: UserMenuProps): JSX.Element {
  const navigate = useNavigate();

  return (
    <Dropdown
      trigger={
        <span className="omni-user-menu__trigger">
          <Avatar name={name} src={avatarUrl ?? undefined} size="sm" />
          <span className="omni-user-menu__name">{name}</span>
        </span>
      }
      items={[
        {
          key: "identity",
          label: (
            <span className="omni-user-menu__identity">
              <span className="omni-user-menu__identity-name">{name}</span>
              {email && <span className="omni-user-menu__identity-email">{email}</span>}
            </span>
          ),
          disabled: true,
        },
        { key: "profile", label: "Profile", onSelect: () => navigate("/app/settings") },
        { key: "settings", label: "Settings", onSelect: () => navigate("/app/settings") },
        { key: "logout", label: "Logout", onSelect: onSignOut },
      ]}
    />
  );
}
