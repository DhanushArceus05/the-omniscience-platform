import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";
import { AdaptiveBackground, FadeIn, GlassCard } from "@omniscience/ui";

export interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps): JSX.Element {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--omni-space-6)",
      }}
    >
      <AdaptiveBackground showNeuralLines={false} />
      <FadeIn>
        <GlassCard style={{ width: "min(420px, 100%)" }}>
          <Link
            to="/"
            style={{
              display: "inline-block",
              marginBottom: "var(--omni-space-6)",
              fontSize: "var(--omni-text-sm)",
              color: "var(--omni-color-text-secondary)",
              textDecoration: "none",
            }}
          >
            ← Omniscience
          </Link>
          <h1 style={{ fontSize: "var(--omni-text-2xl)" }}>{title}</h1>
          {subtitle && (
            <p
              style={{
                color: "var(--omni-color-text-secondary)",
                fontSize: "var(--omni-text-sm)",
                marginTop: "var(--omni-space-2)",
                marginBottom: "var(--omni-space-6)",
              }}
            >
              {subtitle}
            </p>
          )}
          <div style={{ marginTop: subtitle ? 0 : "var(--omni-space-6)" }}>{children}</div>
          {footer && (
            <div
              style={{
                marginTop: "var(--omni-space-6)",
                fontSize: "var(--omni-text-sm)",
                color: "var(--omni-color-text-secondary)",
                textAlign: "center",
              }}
            >
              {footer}
            </div>
          )}
        </GlassCard>
      </FadeIn>
    </div>
  );
}
