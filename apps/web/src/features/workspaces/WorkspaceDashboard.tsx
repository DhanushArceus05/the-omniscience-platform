import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";
import { createWorkspaceRequestSchema } from "@omniscience/schemas";
import type { Workspace } from "@omniscience/types";
import { Alert, Button, Card, EmptyState, ErrorState, Input, Modal, Spinner } from "@omniscience/ui";
import { useAuth } from "../../lib/auth/AuthContext";
import { getFieldErrors, type FieldErrors } from "../../lib/auth/authErrors";
import { validateWithSchema } from "../../lib/auth/validateWithSchema";
import { getWorkspaceErrorMessage } from "./workspaceErrors";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; workspaces: Workspace[] };

const UNCONFIGURED_MESSAGE = "Workspaces are unavailable right now — the API isn't configured.";

/**
 * Phase 3 Step 2 — replaces the "Dashboard arrives in Phase 3" placeholder
 * with a real, minimal dashboard: list the caller's own workspaces
 * (newest first, one bounded page — no infinite scroll/"load more" UI
 * yet, that's a later step) and create new ones from a modal form.
 *
 * Deliberately NOT included here (all explicitly deferred to later
 * steps — see `claude/CURRENT_PHASE.md`):
 * - No "open workspace" navigation/detail route — nothing to navigate to yet.
 * - No update/delete UI — the backend doesn't expose those endpoints yet.
 * - No automatic 401-refresh-and-retry: a stale/expired access token
 *   surfaces as the same recoverable `ErrorState` any other failure
 *   would, with a "Try again" action. Centralized in-page refresh
 *   remains a documented future step, not something bolted on here.
 */
export function WorkspaceDashboard(): JSX.Element {
  const { client, accessToken } = useAuth();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [createError, setCreateError] = useState<string | null>(null);

  const loadWorkspaces = useCallback(async () => {
    if (!client || !accessToken) {
      // Never leaves the page loading forever: a missing config or a
      // (should-be-impossible-here, since this only renders behind
      // ProtectedRoute) missing token resolves straight to a visible,
      // recoverable error state.
      setState({ phase: "error", message: UNCONFIGURED_MESSAGE });
      return;
    }
    setState({ phase: "loading" });
    try {
      const result = await client.listWorkspaces(accessToken);
      setState({ phase: "ready", workspaces: result.workspaces });
    } catch (error) {
      setState({ phase: "error", message: getWorkspaceErrorMessage(error) });
    }
  }, [client, accessToken]);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  function openCreateModal(): void {
    setName("");
    setDescription("");
    setFieldErrors({});
    setCreateError(null);
    setModalOpen(true);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreateError(null);

    const validation = validateWithSchema(createWorkspaceRequestSchema, {
      name,
      description: description.trim() === "" ? undefined : description,
    });
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    setFieldErrors({});

    if (!client || !accessToken) {
      setCreateError(UNCONFIGURED_MESSAGE);
      return;
    }

    setCreating(true);
    try {
      const created = await client.createWorkspace(accessToken, validation.data);
      // Prepend rather than re-fetch: the new workspace is always the
      // newest, so this keeps the list in the same newest-first order
      // the backend guarantees, without a second network round-trip —
      // and updates the visible list immediately, with no page refresh.
      setState((previous) =>
        previous.phase === "ready"
          ? { phase: "ready", workspaces: [created, ...previous.workspaces] }
          : { phase: "ready", workspaces: [created] },
      );
      setModalOpen(false);
    } catch (error) {
      setFieldErrors(getFieldErrors(error));
      setCreateError(getWorkspaceErrorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  if (state.phase === "loading") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "var(--omni-space-8)" }}>
        <Spinner size="lg" label="Loading your workspaces" />
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <ErrorState
        title="Couldn't load your workspaces"
        description={state.message}
        action={
          <Button variant="secondary" onClick={() => void loadWorkspaces()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-6)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--omni-space-4)",
        }}
      >
        <h2 style={{ margin: 0 }}>Your workspaces</h2>
        <Button onClick={openCreateModal}>Create workspace</Button>
      </div>

      {state.workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          description="Create your first workspace to get started."
          action={<Button onClick={openCreateModal}>Create workspace</Button>}
        />
      ) : (
        <div style={{ display: "grid", gap: "var(--omni-space-4)" }} aria-label="Workspace list">
          {state.workspaces.map((workspace) => (
            <Card key={workspace.id}>
              <p style={{ margin: 0, fontWeight: 600 }}>{workspace.name}</p>
              {workspace.description && (
                <p
                  style={{ margin: "var(--omni-space-2) 0 0", opacity: 0.75 }}
                >
                  {workspace.description}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create workspace"
        description="Give your workspace a name to get started."
      >
        <form
          onSubmit={(event) => void handleCreate(event)}
          style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}
        >
          {createError && (
            <Alert tone="error" title="Couldn't create workspace">
              {createError}
            </Alert>
          )}
          <Input
            label="Name"
            required
            value={name}
            error={fieldErrors.name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label="Description (optional)"
            value={description}
            error={fieldErrors.description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Button type="submit" loading={creating} fullWidth>
            Create workspace
          </Button>
        </form>
      </Modal>
    </div>
  );
}
