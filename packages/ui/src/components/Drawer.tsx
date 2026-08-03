import { useEffect, useRef, type JSX, type ReactNode, type RefObject } from "react";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: string;
  children?: ReactNode;
  /**
   * Element to return focus to once the drawer closes (typically the
   * button that opened it). Optional — if omitted, focus is left
   * wherever the browser's default post-unmount behavior puts it.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Off-canvas panel. Locks background scroll while open, closes on
 * Escape (listened for at the document level so it fires regardless of
 * which element inside the drawer currently has focus), moves focus
 * onto the drawer surface on open, and returns focus to
 * `returnFocusRef.current` (if provided) on close.
 */
export function Drawer({
  open,
  onClose,
  side = "right",
  title,
  children,
  returnFocusRef,
}: DrawerProps): JSX.Element | null {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      surfaceRef.current?.focus();
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      returnFocusRef?.current?.focus();
    }
  }, [open, returnFocusRef]);

  if (!open) return null;

  const drawerClasses = ["omni-drawer", side === "left" ? "omni-drawer--left" : "", "omni-motion-slide-left"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="omni-drawer-overlay" onMouseDown={onClose}>
      <div
        ref={surfaceRef}
        className={drawerClasses}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Panel"}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
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
