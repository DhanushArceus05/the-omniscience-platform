import type { JSX, ReactNode } from "react";
import { useReducedMotion } from "./useReducedMotion";

export interface FloatingProps {
  children: ReactNode;
  className?: string;
}

/** Wraps children in a gentle, continuous vertical float. Disabled under reduced motion. */
export function Floating({ children, className }: FloatingProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const classes = [reducedMotion ? "" : "omni-motion-float", className].filter(Boolean).join(" ");
  return <div className={classes || undefined}>{children}</div>;
}
