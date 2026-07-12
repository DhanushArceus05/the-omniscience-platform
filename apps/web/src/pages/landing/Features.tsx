import type { JSX } from "react";
import { GlassCard, SlideIn } from "@omniscience/ui";

interface Feature {
  icon: string;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: "🧭",
    title: "One assistant, every capability",
    description: "A single conversation routes across reasoning, retrieval, vision, voice and prediction.",
  },
  {
    icon: "🔌",
    title: "Provider-agnostic by design",
    description: "Swap or combine model providers behind OmniProvider without touching your workflows.",
  },
  {
    icon: "📚",
    title: "Grounded knowledge",
    description: "Hybrid retrieval and reranking keep answers cited, current and trustworthy.",
  },
  {
    icon: "🤖",
    title: "Multi-agent orchestration",
    description: "Planner, specialist and reviewer agents collaborate before you ever see a response.",
  },
  {
    icon: "📈",
    title: "Predictive intelligence",
    description: "Forecasting, anomaly detection and AutoML sit alongside your everyday assistant.",
  },
  {
    icon: "⚙️",
    title: "Automation that scales",
    description: "Visual workflows with retries, parallelism and replay turn insight into action.",
  },
];

export function Features(): JSX.Element {
  return (
    <section className="omni-container" style={{ paddingBlock: "var(--omni-space-16)" }}>
      <div style={{ textAlign: "center", marginBottom: "var(--omni-space-10)" }}>
        <h2 style={{ fontSize: "var(--omni-text-3xl)" }}>Built for the full breadth of AI work</h2>
        <p style={{ color: "var(--omni-color-text-secondary)", marginTop: "var(--omni-space-2)" }}>
          Every module below is a first-class citizen of the same platform.
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "var(--omni-space-6)",
        }}
      >
        {FEATURES.map((feature, index) => (
          <SlideIn key={feature.title} delayMs={index * 60}>
            <GlassCard>
              <span style={{ fontSize: "var(--omni-text-2xl)" }} aria-hidden="true">
                {feature.icon}
              </span>
              <h3 style={{ fontSize: "var(--omni-text-md)", marginTop: "var(--omni-space-3)" }}>
                {feature.title}
              </h3>
              <p
                style={{
                  color: "var(--omni-color-text-secondary)",
                  fontSize: "var(--omni-text-sm)",
                  marginTop: "var(--omni-space-2)",
                }}
              >
                {feature.description}
              </p>
            </GlassCard>
          </SlideIn>
        ))}
      </div>
    </section>
  );
}
