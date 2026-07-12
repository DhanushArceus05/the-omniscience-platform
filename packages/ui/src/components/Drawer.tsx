import type { JSX, KeyboardEvent, ReactNode } from "react";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: string;
  children?: ReactNode;
}

export function Drawer({ open, onClose, side = "right", title, children }: DrawerProps): JSX.Element | null {
  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") onClose();
  }

  const drawerClasses = ["omni-drawer", side === "left" ? "omni-drawer--left" : "", "omni-motion-slide-left"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="omni-drawer-overlay" onMouseDown={onClose}>
      <div
        className={drawerClasses}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Panel"}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {title && (
          <div className="omni-modal__header">
            <h2 className="omni-modal__title">{title}</h2>
            <button type="button" className="omni-modal__close" aria-label="Close panel" onClick={onClose}>
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
