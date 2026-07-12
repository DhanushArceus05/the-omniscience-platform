import { useRef, type JSX, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { useReducedMotion } from "./useReducedMotion";

export interface MagneticProps {
  children: ReactNode;
  /** Maximum pixel offset applied toward the pointer. */
  strength?: number;
  className?: string;
}

/**
 * Wraps interactive elements (buttons, cards) with a subtle "magnetic"
 * pull toward the cursor on hover. Pure CSS transform + pointer math,
 * no animation library. Disabled under prefers-reduced-motion.
 */
export function Magnetic({ children, strength = 12, className }: MagneticProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  function handleMouseMove(event: ReactMouseEvent<HTMLDivElement>): void {
    if (reducedMotion || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const relativeX = (event.clientX - rect.left) / rect.width - 0.5;
    const relativeY = (event.clientY - rect.top) / rect.height - 0.5;
    ref.current.style.transform = `translate(${relativeX * strength}px, ${relativeY * strength}px)`;
  }

  function handleMouseLeave(): void {
    if (!ref.current) return;
    ref.current.style.transform = "translate(0, 0)";
  }

  const classes = ["omni-magnetic", className].filter(Boolean).join(" ");

  return (
    <div
      ref={ref}
      className={classes}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
}
