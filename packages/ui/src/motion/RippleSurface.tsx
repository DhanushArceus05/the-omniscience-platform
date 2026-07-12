import { useState, type JSX, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useReducedMotion } from "./useReducedMotion";

interface RippleInstance {
  id: number;
  x: number;
  y: number;
  size: number;
}

export interface RippleSurfaceProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

let rippleIdCounter = 0;

/**
 * A small hook that spawns expanding ripple circles from the pointer-down
 * location on whatever element spreads its returned props. Used by
 * Button (and any other clickable surface) to add tactile feedback
 * without pulling in an animation library. No-ops under
 * prefers-reduced-motion.
 */
export function useRipple(disabled?: boolean): {
  ripples: RippleInstance[];
  onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
} {
  const [ripples, setRipples] = useState<RippleInstance[]>([]);
  const reducedMotion = useReducedMotion();

  function onMouseDown(event: ReactMouseEvent<HTMLElement>): void {
    if (disabled || reducedMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    const id = ++rippleIdCounter;
    const ripple: RippleInstance = {
      id,
      x: event.clientX - rect.left - size / 2,
      y: event.clientY - rect.top - size / 2,
      size,
    };
    setRipples((prev) => [...prev, ripple]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 650);
  }

  return { ripples, onMouseDown };
}

/**
 * Convenience wrapper for non-button surfaces (e.g. GlassCard) that
 * want the same ripple feedback without managing the hook themselves.
 */
export function RippleSurface({ children, className, disabled }: RippleSurfaceProps): JSX.Element {
  const { ripples, onMouseDown } = useRipple(disabled);
  const classes = ["omni-ripple-surface", className].filter(Boolean).join(" ");

  return (
    <span className={classes} onMouseDown={onMouseDown}>
      {children}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          aria-hidden="true"
          className="omni-ripple-circle"
          style={{
            left: ripple.x,
            top: ripple.y,
            width: ripple.size,
            height: ripple.size,
          }}
        />
      ))}
    </span>
  );
}
