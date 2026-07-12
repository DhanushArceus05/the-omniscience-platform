import type { JSX } from "react";
import { Tooltip, useTheme } from "@omniscience/ui";

const ICONS: Record<string, string> = {
  light: "☀️",
  dark: "🌙",
  system: "🖥️",
};

const NEXT: Record<string, "light" | "dark" | "system"> = {
  light: "dark",
  dark: "system",
  system: "light",
};

/** Cycles the theme preference: light -> dark -> system -> light. */
export function ThemeToggle(): JSX.Element {
  const { theme, setTheme } = useTheme();

  return (
    <Tooltip label={`Theme: ${theme}. Click to switch.`}>
      <button
        type="button"
        aria-label={`Switch theme (currently ${theme})`}
        onClick={() => setTheme(NEXT[theme] ?? "system")}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: "var(--omni-radius-md)",
          fontSize: "1rem",
        }}
        className="omni-glass-transition"
      >
        {ICONS[theme] ?? "🖥️"}
      </button>
    </Tooltip>
  );
}
