import type { JSX } from "react";
import { FadeIn } from "@omniscience/ui";

const POINTS = [
  {
    title: "No more tool sprawl",
    body: "Stop stitching together a chatbot, a BI tool, an OCR service and an automation platform.",
  },
  {
    title: "Consistent governance",
    body: "One place to apply validation, fallback and review policies across every capability.",
  },
  {
    title: "Grows with your needs",
    body: "New Omni-modules plug into the same OmniCore routing layer without re-architecting anything.",
  },
];

export function WhyOmniscience(): JSX.Element {
  return (
    <section className="omni-container" style={{ paddingBlock: "var(--omni-space-16)" }}>
      <FadeIn>
        <h2 style={{ fontSize: "var(--omni-text-3xl)", textAlign: "center", marginBottom: "var(--omni-space-10)" }}>
          Why Omniscience
        </h2>
      </FadeIn>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "var(--omni-space-8)",
        }}
      >
        {POINTS.map((point) => (
          <div key={point.title}>
            <h3 style={{ fontSize: "var(--omni-text-md)", color: "var(--omni-color-accent)" }}>{point.title}</h3>
            <p
              style={{
                color: "var(--omni-color-text-secondary)",
                fontSize: "var(--omni-text-sm)",
                marginTop: "var(--omni-space-2)",
              }}
            >
              {point.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
