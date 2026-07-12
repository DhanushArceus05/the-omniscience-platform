import type { HTMLAttributes, JSX } from "react";

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover affordance styling for clickable cards. */
  interactive?: boolean;
}

export function GlassCard({ className, interactive, children, ...rest }: GlassCardProps): JSX.Element {
  const classes = [
    "omni-glass-card",
    "omni-glass-transition",
    interactive ? "omni-glass-card--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
