import { useId, useState, type JSX, type ReactNode } from "react";

export interface TooltipProps {
  label: string;
  children: ReactNode;
  /**
   * Which side of the trigger the tooltip renders on.
   * Defaults to "top" to preserve prior behavior for any existing
   * caller that doesn't pass this prop. Callers anchored near the top
   * viewport edge (e.g. header icons) should pass "bottom" so the
   * tooltip isn't clipped above the trigger.
   */
  placement?: "top" | "bottom";
  /**
   * Horizontal alignment of the tooltip relative to its trigger.
   * Defaults to "center" to preserve prior behavior for any existing
   * caller that doesn't pass this prop.
   *
   * Centering (`left: 50%; transform: translateX(-50%)`) assumes there's
   * equal room on both sides of the trigger. For triggers pinned near the
   * right viewport edge (e.g. the last icon in a header's action row), a
   * centered nowrap label can extend past the viewport's right edge,
   * growing the document's scrollable width and causing an intermittent
   * horizontal/vertical scrollbar as the tooltip toggles visible. Passing
   * "end" anchors the tooltip's right edge to the trigger's right edge
   * instead, so it grows leftward into space that's already available.
   */
  align?: "center" | "end";
}

export function Tooltip({
  label,
  children,
  placement = "top",
  align = "center",
}: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();

  return (
    <span
      className="omni-tooltip-wrapper"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span aria-describedby={visible ? tooltipId : undefined}>{children}</span>
      {visible && (
        <span
          role="tooltip"
          id={tooltipId}
          className={`omni-tooltip omni-tooltip--${placement} omni-tooltip--align-${align} omni-motion-fade`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
