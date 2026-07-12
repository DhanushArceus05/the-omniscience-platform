import type { JSX } from "react";

export interface ProgressProps {
  /** 0-100. Values outside this range are clamped. */
  value: number;
  label?: string;
}

export function Progress({ value, label }: ProgressProps): JSX.Element {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      className="omni-progress"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="omni-progress__bar" style={{ width: `${clamped}%` }} />
    </div>
  );
}
