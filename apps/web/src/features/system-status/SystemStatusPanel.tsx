import { useEffect, useMemo, useState, type JSX } from "react";
import { OmniscienceClient } from "@omniscience/sdk";
import type { HealthCheckResponse } from "@omniscience/types";
import { GlassCard, StatusBadge, type StatusBadgeTone } from "@omniscience/ui";

type LoadState<T> =
  | { phase: "loading" }
  | { phase: "success"; data: T }
  | { phase: "error"; message: string }
  | { phase: "config-error"; message: string };

const CONFIG_ERROR_STATE: LoadState<HealthCheckResponse> = {
  phase: "config-error",
  message: "Configuration unavailable",
};

/**
 * Builds the SDK client from Vite env vars. Never throws: if
 * VITE_API_BASE_URL / VITE_AI_SERVICE_BASE_URL are missing (e.g. the
 * frontend is running standalone, without the API/AI service configured),
 * this returns `null` instead of letting `OmniscienceClient`'s constructor
 * error escape — that error, if left uncaught at module scope, would
 * crash the entire app (including the landing and auth routes) before
 * React ever renders. Missing config is a normal, recoverable state that
 * SystemStatusPanel surfaces via CONFIG_ERROR_STATE instead.
 */
function createClient(): OmniscienceClient | null {
  try {
    return new OmniscienceClient({
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
      aiServiceBaseUrl: import.meta.env.VITE_AI_SERVICE_BASE_URL,
    });
  } catch {
    return null;
  }
}

function toneFor(state: LoadState<HealthCheckResponse>): StatusBadgeTone {
  if (state.phase === "success") {
    return state.data.status === "ok" ? "ok" : "degraded";
  }
  if (state.phase === "error" || state.phase === "config-error") {
    return "down";
  }
  return "degraded";
}

function labelFor(name: string, state: LoadState<HealthCheckResponse>): string {
  if (state.phase === "loading") return `${name}: checking…`;
  if (state.phase === "config-error") return `${name}: configuration unavailable`;
  if (state.phase === "error") return `${name}: unreachable`;
  return `${name}: ${state.data.status}`;
}

/**
 * The Phase 0 API/AI-service health check, unchanged in behavior and
 * moved here so it can live inside the new Phase 1 shell (see
 * AppShellPreviewPage) instead of owning the whole screen. Do not
 * remove: this is the only functional (non-UI-only) piece carried
 * over from Phase 0, and it is explicitly allowed to keep working.
 */
export function SystemStatusPanel(): JSX.Element {
  const client = useMemo(createClient, []);

  const [apiHealth, setApiHealth] = useState<LoadState<HealthCheckResponse>>(
    client ? { phase: "loading" } : CONFIG_ERROR_STATE,
  );
  const [aiHealth, setAiHealth] = useState<LoadState<HealthCheckResponse>>(
    client ? { phase: "loading" } : CONFIG_ERROR_STATE,
  );

  useEffect(() => {
    if (!client) {
      // Nothing to check: VITE_API_BASE_URL / VITE_AI_SERVICE_BASE_URL
      // are not configured. The initial config-error state already
      // reflects that; there is no request to make.
      return undefined;
    }

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
  }, [client]);

  return (
    <GlassCard aria-label="Service health">
      <h2 style={{ fontSize: "var(--omni-text-lg)", marginBottom: "var(--omni-space-4)" }}>
        System status
      </h2>
      <section
        aria-label="Service health"
        style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}
      >
        <StatusBadge tone={toneFor(apiHealth)} label={labelFor("API", apiHealth)} />
        <StatusBadge tone={toneFor(aiHealth)} label={labelFor("AI Service", aiHealth)} />
      </section>
    </GlassCard>
  );
}
