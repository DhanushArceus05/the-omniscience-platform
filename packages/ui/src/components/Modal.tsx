import { useEffect, useRef, type JSX, type KeyboardEvent, type ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: ReactNode;
  /** Extra content rendered after the description, before children (e.g. action buttons). */
  footer?: ReactNode;
  closeOnOverlayClick?: boolean;
}

/**
 * Base overlay dialog. Traps Escape-to-close and returns focus to the
 * trigger element on close is left to the consumer (no router/portal
 * dependency here) — this component focuses the dialog surface itself
 * on open so keyboard users land inside it immediately.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeOnOverlayClick = true,
}: ModalProps): JSX.Element | null {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      surfaceRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      onClose();
    }
  }

  function handleOverlayClick(): void {
    if (closeOnOverlayClick) onClose();
  }

  return (
    <div className="omni-overlay" onMouseDown={handleOverlayClick}>
      <div
        ref={surfaceRef}
        className="omni-modal omni-motion-scale"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "omni-modal-title" : undefined}
        aria-describedby={description ? "omni-modal-description" : undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {(title ?? description) && (
          <div className="omni-modal__header">
            <div>
              {title && (
                <h2 className="omni-modal__title" id="omni-modal-title">
                  {title}
                </h2>
              )}
              {description && (
                <p className="omni-modal__description" id="omni-modal-description">
                  {description}
                </p>
              )}
            </div>
            <button type="button" className="omni-modal__close" aria-label="Close dialog" onClick={onClose}>
              ×
            </button>
          </div>
        )}
        {children}
        {footer && <div className="omni-modal__actions">{footer}</div>}
      </div>
    </div>
  );
}
