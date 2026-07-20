import { useCallback, useEffect, useState, type JSX } from "react";
import type { SessionSummary } from "@omniscience/types";
import { Alert, Button, Card, ErrorState, Spinner } from "@omniscience/ui";
import { useAuth } from "../../lib/auth/AuthContext";
import { getAccountSettingsErrorMessage } from "./accountSettingsErrors";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; sessions: SessionSummary[] };

function formatCreatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Sessions tab of the Settings experience (Phase 3 Step 3): lists the
 * caller's own active sessions (newest first, per `GET /auth/sessions`),
 * lets them revoke any individual one, or sign out of every session
 * except the one making this request.
 *
 * Known limitation, called out plainly rather than worked around: a
 * session here is only `{ tokenId, createdAt }` — there is no
 * device/browser/IP metadata (none is stored server-side, see
 * `RefreshTokenStore`), and there is no way to mark "this is your
 * current session" (access tokens don't carry `tokenId`). Both are
 * flagged in this step's known limitations, not silently faked here.
 */
export function SessionsSection(): JSX.Element {
  const { client, accessToken } = useAuth();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!client || !accessToken) {
      setState({ phase: "error", message: "Sessions are unavailable right now — the API isn't configured." });
      return;
    }
    setState({ phase: "loading" });
    try {
      const sessions = await client.listSessions(accessToken);
      setState({ phase: "ready", sessions });
    } catch (error) {
      setState({ phase: "error", message: getAccountSettingsErrorMessage(error) });
    }
  }, [client, accessToken]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function handleRevoke(tokenId: string): Promise<void> {
    if (!client || !accessToken) return;
    setActionError(null);
    setRevokingTokenId(tokenId);
    try {
      await client.revokeSession(accessToken, tokenId);
      setState((previous) =>
        previous.phase === "ready"
          ? { phase: "ready", sessions: previous.sessions.filter((s) => s.tokenId !== tokenId) }
          : previous,
      );
    } catch (error) {
      setActionError(getAccountSettingsErrorMessage(error));
    } finally {
      setRevokingTokenId(null);
    }
  }

  async function handleRevokeAll(): Promise<void> {
    if (!client || !accessToken) return;
    setActionError(null);
    setRevokingAll(true);
    try {
      await client.revokeAllSessions(accessToken);
      await loadSessions();
    } catch (error) {
      setActionError(getAccountSettingsErrorMessage(error));
    } finally {
      setRevokingAll(false);
    }
  }

  if (state.phase === "loading") {
    return (
      <Card>
        <div style={{ display: "flex", justifyContent: "center", padding: "var(--omni-space-6)" }}>
          <Spinner size="lg" label="Loading your sessions" />
        </div>
      </Card>
    );
  }

  if (state.phase === "error") {
    return (
      <ErrorState
        title="Couldn't load your sessions"
        description={state.message}
        action={
          <Button variant="secondary" onClick={() => void loadSessions()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <Card>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--omni-space-4)",
          marginBottom: "var(--omni-space-4)",
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0 }}>Active sessions</h3>
        {state.sessions.length > 1 && (
          <Button variant="secondary" onClick={() => void handleRevokeAll()} loading={revokingAll}>
            Sign out of all other sessions
          </Button>
        )}
      </div>

      {actionError && (
        <div style={{ marginBottom: "var(--omni-space-4)" }}>
          <Alert tone="error" title="Something went wrong">
            {actionError}
          </Alert>
        </div>
      )}

      {state.sessions.length === 0 ? (
        <p>No active sessions found.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--omni-space-3)" }}>
          {state.sessions.map((session) => (
            <li
              key={session.tokenId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--omni-space-3)",
                flexWrap: "wrap",
              }}
            >
              <span>Signed in since {formatCreatedAt(session.createdAt)}</span>
              <Button
                variant="ghost"
                onClick={() => void handleRevoke(session.tokenId)}
                loading={revokingTokenId === session.tokenId}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
