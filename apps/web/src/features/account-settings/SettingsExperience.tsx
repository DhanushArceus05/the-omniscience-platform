import { useState, type JSX } from "react";
import { Tabs } from "@omniscience/ui";
import { DangerZoneSection } from "./DangerZoneSection";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./SecuritySection";
import { SessionsSection } from "./SessionsSection";

type SettingsTabKey = "profile" | "security" | "sessions" | "danger-zone";

/**
 * The single premium Settings experience at `/app/settings` (Phase 3
 * Step 3, locked scope: one page with tabs — no separate `/app/profile`
 * route). Each tab's content only mounts when active, so e.g. the
 * Sessions tab's `GET /auth/sessions` call doesn't fire until the user
 * actually opens that tab.
 */
export function SettingsExperience(): JSX.Element {
  const [activeKey, setActiveKey] = useState<SettingsTabKey>("profile");

  return (
    <Tabs
      activeKey={activeKey}
      onChange={(key) => setActiveKey(key as SettingsTabKey)}
      items={[
        { key: "profile", label: "Profile", content: <ProfileSection /> },
        { key: "security", label: "Security", content: <SecuritySection /> },
        { key: "sessions", label: "Sessions", content: <SessionsSection /> },
        { key: "danger-zone", label: "Danger Zone", content: <DangerZoneSection /> },
      ]}
    />
  );
}
