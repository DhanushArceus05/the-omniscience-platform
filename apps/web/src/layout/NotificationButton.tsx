import type { JSX } from "react";
import { Tooltip } from "@omniscience/ui";

export function NotificationButton(): JSX.Element {
  return (
    <Tooltip label="Notifications (coming soon)">
      <button
        type="button"
        aria-label="Notifications"
        className="omni-glass-transition"
        style={{
          all: "unset",
          position: "relative",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: "var(--omni-radius-md)",
          fontSize: "1rem",
        }}
      >
        🔔
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--omni-color-accent-2)",
          }}
        />
      </button>
    </Tooltip>
  );
}
