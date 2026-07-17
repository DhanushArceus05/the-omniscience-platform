import type { JSX } from "react";

export type StatusBadgeTone = "ok" | "degraded" | "down" | "neutral";

export interface StatusBadgeProps {
  tone: StatusBadgeTone;
  label: string;
}

const toneStyles: Record<StatusBadgeTone, { background: string; color: string }> = {
  ok: { background: "#0f2e1d", color: "#4ade80" },
  degraded: { background: "#2e2a0f", color: "#fbbf24" },
  down: { background: "#2e0f14", color: "#f87171" },
  neutral: { background: "#25272b", color: "#9ca3af" },
};

/**
 * Minimal status indicator used by the Phase 0 health page.
 * The full themed design system (glassmorphism, motion, dark theme)
 * is introduced in Phase 1 per docs/03_Product_Design.md.
 */
export function StatusBadge({ tone, label }: StatusBadgeProps): JSX.Element {
  const style = toneStyles[tone];
  return (
    <span
      data-testid="status-badge"
      data-tone={tone}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.25rem 0.75rem",
        borderRadius: "999px",
        fontSize: "0.85rem",
        fontFamily: "system-ui, sans-serif",
        background: style.background,
        color: style.color,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: style.color,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
