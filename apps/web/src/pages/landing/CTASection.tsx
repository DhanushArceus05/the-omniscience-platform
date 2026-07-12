import type { JSX } from "react";
import { Link } from "react-router-dom";
import { GlassCard, Magnetic, ScaleIn } from "@omniscience/ui";

export function CTASection(): JSX.Element {
  return (
    <section className="omni-container" style={{ paddingBlock: "var(--omni-space-16)" }}>
      <ScaleIn>
        <GlassCard
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--omni-space-4)",
            textAlign: "center",
            padding: "var(--omni-space-12)",
          }}
        >
          <h2 style={{ fontSize: "var(--omni-text-2xl)" }}>Ready to see it in one place?</h2>
          <p style={{ color: "var(--omni-color-text-secondary)", maxWidth: "48ch" }}>
            Create an account to preview the platform shell — full module access rolls out phase by phase.
          </p>
          <Magnetic>
            <Link to="/register" className="omni-button omni-button--primary omni-button--lg">
              Create your account
            </Link>
          </Magnetic>
        </GlassCard>
      </ScaleIn>
    </section>
  );
}
