import type { JSX } from "react";
import { Avatar, Dropdown } from "@omniscience/ui";

export interface UserMenuProps {
  name: string;
}

/** UI-only user menu. Sign-out/account actions are wired up once auth lands in Phase 2. */
export function UserMenu({ name }: UserMenuProps): JSX.Element {
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
        { key: "sign-out", label: "Sign out (coming soon)", disabled: true },
      ]}
    />
  );
}
