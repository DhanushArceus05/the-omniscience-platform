import type { JSX, ReactNode } from "react";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  action?: ReactNode;
}

export function ErrorState({
  title = "Something went wrong",
  description = "Please try again, or come back later.",
  action,
}: ErrorStateProps): JSX.Element {
  return (
    <div className="omni-state omni-state--error omni-motion-fade" role="alert">
      <span className="omni-state__icon" aria-hidden="true">
        !
      </span>
      <p className="omni-state__title">{title}</p>
      <p className="omni-state__description">{description}</p>
      {action}
    </div>
  );
}
