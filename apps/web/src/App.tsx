import { useEffect, useState } from "react";
import { OmniscienceClient } from "@omniscience/sdk";
import type { HealthCheckResponse } from "@omniscience/types";
import { StatusBadge, type StatusBadgeTone } from "@omniscience/ui";

type LoadState<T> =
  { phase: "loading" } | { phase: "success"; data: T } | { phase: "error"; message: string };

const client = new OmniscienceClient({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  aiServiceBaseUrl: import.meta.env.VITE_AI_SERVICE_BASE_URL,
});

function toneFor(state: LoadState<HealthCheckResponse>): StatusBadgeTone {
  if (state.phase === "success") {
    return state.data.status === "ok" ? "ok" : "degraded";
  }
  if (state.phase === "error") {
    return "down";
  }
  return "degraded";
}

function labelFor(name: string, state: LoadState<HealthCheckResponse>): string {
  if (state.phase === "loading") return `${name}: checking…`;
  if (state.phase === "error") return `${name}: unreachable`;
  return `${name}: ${state.data.status}`;
}

/**
 * Phase 0 Foundation shell. This is intentionally minimal — the
 * premium dark-theme UI (glassmorphism, command palette, adaptive
 * widgets) is built in Phase 1 per docs/03_Product_Design.md.
 */
export function App(): JSX.Element {
  const [apiHealth, setApiHealth] = useState<LoadState<HealthCheckResponse>>({
    phase: "loading",
  });
  const [aiHealth, setAiHealth] = useState<LoadState<HealthCheckResponse>>({
    phase: "loading",
  });

  useEffect(() => {
    let cancelled = false;

    client
      .getApiHealth()
      .then((data) => {
        if (!cancelled) setApiHealth({ phase: "success", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setApiHealth({
            phase: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      });

    client
      .getAiServiceHealth()
      .then((data) => {
        if (!cancelled) setAiHealth({ phase: "success", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAiHealth({
            phase: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.5rem",
        background: "#0a0a0f",
        color: "#e5e7eb",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div>
        <h1 style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>The Omniscience Platform</h1>
        <p style={{ color: "#9ca3af", margin: 0 }}>
          Phase 0 — Foundation shell. One Platform. Every Intelligence.
        </p>
      </div>

      <section
        aria-label="Service health"
        style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}
      >
        <StatusBadge tone={toneFor(apiHealth)} label={labelFor("API", apiHealth)} />
        <StatusBadge tone={toneFor(aiHealth)} label={labelFor("AI Service", aiHealth)} />
      </section>
    </main>
  );
}
