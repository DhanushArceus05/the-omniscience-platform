import type { JSX } from "react";
import { AppShell } from "../layout/AppShell";
import { APP_NAV_ITEMS } from "../layout/navItems";
import { SettingsExperience } from "../features/account-settings/SettingsExperience";
import { useAuth } from "../lib/auth/AuthContext";

/**
 * Reachable at /app/settings (behind `ProtectedRoute`, same as `/app`).
 * Phase 3 Step 3 replaces the sidebar's former dead `/app/settings` link
 * and the account menu's disabled "Profile (coming soon)"/"Settings
 * (coming soon)" entries with this single, real settings experience —
 * see `SettingsExperience`'s docstring for the locked "one page, four
 * tabs" scope.
 */
export function AccountSettingsPage(): JSX.Element {
  const { user, logout } = useAuth();

  return (
    <AppShell
      navItems={APP_NAV_ITEMS}
      breadcrumbs={[{ label: "Overview", to: "/app" }, { label: "Settings" }]}
      userName={user?.name ?? "Guest User"}
      avatarUrl={user?.avatarUrl}
      onSignOut={() => void logout()}
    >
      <SettingsExperience />
    </AppShell>
  );
}
