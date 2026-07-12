import type { JSX, ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="omni-state omni-motion-fade">
      {icon && (
        <span className="omni-state__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="omni-state__title">{title}</p>
      {description && <p className="omni-state__description">{description}</p>}
      {action}
    </div>
  );
}
