import type { CSSProperties, JSX } from "react";

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  circle?: boolean;
  className?: string;
}

export function Skeleton({ width = "100%", height = "1rem", circle, className }: SkeletonProps): JSX.Element {
  const classes = ["omni-skeleton", className].filter(Boolean).join(" ");
  const style: CSSProperties = {
    width,
    height,
    borderRadius: circle ? "50%" : undefined,
  };
  return <span className={classes} style={style} aria-hidden="true" />;
}
