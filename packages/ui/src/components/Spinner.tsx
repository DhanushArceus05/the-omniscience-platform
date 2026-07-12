import type { JSX } from "react";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps {
  size?: SpinnerSize;
  label?: string;
  className?: string;
}

export function Spinner({ size = "md", label = "Loading", className }: SpinnerProps): JSX.Element {
  const classes = ["omni-spinner", `omni-spinner--${size}`, className].filter(Boolean).join(" ");
  return <span role="status" aria-label={label} className={classes} />;
}
