import type { JSX, ReactNode } from "react";
import { useReducedMotion } from "./useReducedMotion";

export interface RouteTransitionProps {
  /**
   * A value that changes whenever the route/page changes (e.g. a
   * router's `location.pathname`). Remounting on key change is what
   * re-triggers the CSS entrance animation. Kept decoupled from any
   * specific router so this package has no routing dependency.
   */
  routeKey: string;
  children: ReactNode;
}

/** Fades/slides in page content whenever `routeKey` changes. */
export function RouteTransition({ routeKey, children }: RouteTransitionProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  return (
    <div key={routeKey} className={reducedMotion ? undefined : "omni-motion-page-enter"}>
      {children}
    </div>
  );
}
