import type { JSX } from "react";
import { Badge, GlassCard } from "@omniscience/ui";

interface ModulePreview {
  name: string;
  tagline: string;
}

const MODULES: ModulePreview[] = [
  { name: "OmniCore", tagline: "Routing, planning & orchestration" },
  { name: "OmniProvider", tagline: "Provider & model manager" },
  { name: "OmniKnowledge", tagline: "RAG, embeddings & citations" },
  { name: "OmniAgents", tagline: "Multi-agent collaboration" },
  { name: "OmniPredict", tagline: "Forecasting & AutoML" },
  { name: "OmniVision", tagline: "OCR & visual understanding" },
  { name: "OmniVoice / OmniLingo", tagline: "Speech & translation" },
  { name: "OmniFlow", tagline: "Visual workflow automation" },
];

export function ModulesPreview(): JSX.Element {
  return (
    <section className="omni-container" style={{ paddingBlock: "var(--omni-space-16)" }}>
      <div style={{ textAlign: "center", marginBottom: "var(--omni-space-10)" }}>
        <h2 style={{ fontSize: "var(--omni-text-3xl)" }}>The Omni-module lineup</h2>
        <p style={{ color: "var(--omni-color-text-secondary)", marginTop: "var(--omni-space-2)" }}>
          Each module ships independently — this Phase 1 build is the UI foundation they'll all sit on.
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "var(--omni-space-4)",
        }}
      >
        {MODULES.map((mod) => (
          <GlassCard key={mod.name} interactive>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ fontSize: "var(--omni-text-sm)" }}>{mod.name}</h3>
              <Badge tone="accent">Roadmap</Badge>
            </div>
            <p
              style={{
                color: "var(--omni-color-text-secondary)",
                fontSize: "var(--omni-text-xs)",
                marginTop: "var(--omni-space-2)",
              }}
            >
              {mod.tagline}
            </p>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}
