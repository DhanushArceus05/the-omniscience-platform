import type { CSSProperties, JSX, ReactNode } from "react";
import { useReducedMotion } from "./useReducedMotion";

export type RevealVariant = "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "scale";

const variantClassName: Record<RevealVariant, string> = {
  fade: "omni-motion-fade",
  "slide-up": "omni-motion-slide-up",
  "slide-down": "omni-motion-slide-down",
  "slide-left": "omni-motion-slide-left",
  "slide-right": "omni-motion-slide-right",
  scale: "omni-motion-scale",
};

export interface RevealProps {
  children: ReactNode;
  variant?: RevealVariant;
  /** Delay before the animation starts, in milliseconds. */
  delayMs?: number;
  as?: "div" | "section" | "span" | "li";
  className?: string;
}

/**
 * Generic entrance-animation wrapper. Honors prefers-reduced-motion by
 * rendering children with no animation class at all in that case.
 */
export function Reveal({
  children,
  variant = "fade",
  delayMs = 0,
  as = "div",
  className,
}: RevealProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const Tag = as;
  const style: CSSProperties = delayMs > 0 ? { animationDelay: `${delayMs}ms` } : {};
  const classes = [reducedMotion ? "" : variantClassName[variant], className].filter(Boolean).join(" ");

  return (
    <Tag className={classes || undefined} style={style}>
      {children}
    </Tag>
  );
}

export function FadeIn(props: Omit<RevealProps, "variant">): JSX.Element {
  return <Reveal {...props} variant="fade" />;
}

export function SlideIn(
  props: Omit<RevealProps, "variant"> & { direction?: "up" | "down" | "left" | "right" },
): JSX.Element {
  const { direction = "up", ...rest } = props;
  const variantMap = {
    up: "slide-up",
    down: "slide-down",
    left: "slide-left",
    right: "slide-right",
  } as const;
  return <Reveal {...rest} variant={variantMap[direction]} />;
}

export function ScaleIn(props: Omit<RevealProps, "variant">): JSX.Element {
  return <Reveal {...props} variant="scale" />;
}
