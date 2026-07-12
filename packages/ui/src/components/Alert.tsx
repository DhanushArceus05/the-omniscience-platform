import type { HTMLAttributes, JSX } from "react";

export type AlertTone = "info" | "success" | "warning" | "error";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  title?: string;
}

export function Alert({ tone = "info", title, className, children, ...rest }: AlertProps): JSX.Element {
  const classes = ["omni-alert", `omni-alert--${tone}`, className].filter(Boolean).join(" ");
  return (
    <div className={classes} role={tone === "error" ? "alert" : "status"} {...rest}>
      <div className="omni-alert__body">
        {title && <p className="omni-alert__title">{title}</p>}
        {children}
      </div>
    </div>
  );
}
