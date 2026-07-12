import type { JSX } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  /** Renders the confirm button in the danger variant for destructive actions. */
  destructive?: boolean;
  confirmLoading?: boolean;
}

/** A confirm/alert dialog: Modal plus a standard title/description/actions layout. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  destructive = false,
  confirmLoading = false,
}: DialogProps): JSX.Element | null {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            loading={confirmLoading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
