import { forwardRef, type ButtonHTMLAttributes, type JSX, type ReactNode } from "react";
import { useRipple } from "../motion/RippleSurface";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button while true. */
  loading?: boolean;
  fullWidth?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    fullWidth = false,
    startIcon,
    endIcon,
    disabled,
    className,
    children,
    onMouseDown,
    type = "button",
    ...rest
  },
  ref,
): JSX.Element {
  const isDisabled = disabled || loading;
  const { ripples, onMouseDown: triggerRipple } = useRipple(isDisabled);

  const classes = [
    "omni-button",
    "omni-ripple-surface",
    `omni-button--${variant}`,
    `omni-button--${size}`,
    fullWidth ? "omni-button--full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={classes}
      onMouseDown={(event) => {
        triggerRipple(event);
        onMouseDown?.(event);
      }}
      {...rest}
    >
      {loading && (
        <span className="omni-button__spinner">
          <Spinner size={size === "lg" ? "md" : "sm"} label="Loading" />
        </span>
      )}
      {!loading && startIcon}
      {children}
      {!loading && endIcon}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          aria-hidden="true"
          className="omni-ripple-circle"
          style={{
            left: ripple.x,
            top: ripple.y,
            width: ripple.size,
            height: ripple.size,
          }}
        />
      ))}
    </button>
  );
});
