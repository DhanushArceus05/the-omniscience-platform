import { forwardRef, useId, type InputHTMLAttributes, type JSX, type ReactNode } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Helper text shown below the field; replaced by `error` when present. */
  helperText?: string;
  error?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helperText, error, startIcon, endIcon, className, id, ...rest },
  ref,
): JSX.Element {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = `${inputId}-helper`;
  const hasError = Boolean(error);

  const inputClasses = [
    "omni-input",
    startIcon ? "omni-input--with-start" : "",
    endIcon ? "omni-input--with-end" : "",
    hasError ? "omni-input--error" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="omni-field">
      {label && (
        <label className="omni-field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className="omni-field__control">
        {startIcon && (
          <span className="omni-field__icon-start" aria-hidden="true">
            {startIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={inputClasses}
          aria-invalid={hasError || undefined}
          aria-describedby={helperText || error ? helperId : undefined}
          {...rest}
        />
        {endIcon && (
          <span className="omni-field__icon-end" aria-hidden="true">
            {endIcon}
          </span>
        )}
      </div>
      {(helperText || error) && (
        <span
          id={helperId}
          className={`omni-field__helper${hasError ? " omni-field__helper--error" : ""}`}
          role={hasError ? "alert" : undefined}
        >
          {error ?? helperText}
        </span>
      )}
    </div>
  );
});
