import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Alert, Button, Dropdown, EmptyState, ErrorState, Input, Modal, Spinner } from "@omniscience/ui";
import { useConversations } from "./useConversations";
import { useAuth } from "../../lib/auth/AuthContext";
import "./chat.css";

function formatConversationLabel(title: string | null, createdAt: string): string {
  if (title) return title;
  try {
    return `Conversation — ${new Date(createdAt).toLocaleString()}`;
  } catch {
    return "Conversation";
  }
}

export interface ConversationSidebarProps {
  workspaceId: string;
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onCreated: (conversationId: string) => void;
  /**
   * Called after a conversation is genuinely deleted (Phase 6 Step
   * 4) — for every deletion, not only the active one. `ChatPanel`
   * decides whether `conversationId` was its own `activeConversationId`
   * and, if so, clears it; this component has no opinion on what's
   * currently open.
   */
  onDeleted: (conversationId: string) => void;
}

/**
 * The conversation list/switcher for one workspace's chat page. Loading,
 * creating, selecting, renaming, and deleting are all scoped to this one
 * workspace — there is deliberately no cross-workspace or global chat
 * entry point (see `ChatPage`'s doc comment).
 *
 * The conversation list below is its own independent scroll container
 * (`flex: 1; min-height: 0; overflow-y: auto` — see chat.css's
 * `.omni-chat-conversation-list`) so a long list of conversations can
 * never push this panel's header/"New" button out of view, and adding
 * messages to the active conversation (rendered entirely elsewhere, in
 * `ConversationThread`) can never move this sidebar.
 *
 * Rename/delete (Phase 6 Step 4) are reached via a small per-row `⋮`
 * menu (`Dropdown` — the same component `UserMenu` already uses for its
 * own trigger menu), not always-visible icon buttons: a conversation
 * list can get long, and a menu keeps every row's steady-state layout
 * identical to before this step. Renaming replaces the row's label with
 * an inline `Input` (Enter/blur commits, Escape cancels, matching the
 * "inline rename" convention this UI kit doesn't yet have a dedicated
 * component for). Deleting opens a confirm `Modal` — the same component
 * `WorkspaceDashboard`'s create flow already uses — since deletion is
 * irreversible and cascades to every message in the conversation (see
 * `useConversations.deleteConversation()`'s doc comment).
 */
export function ConversationSidebar({
  workspaceId,
  activeConversationId,
  onSelect,
  onCreated,
  onDeleted,
}: ConversationSidebarProps): JSX.Element {
  const { client, accessToken } = useAuth();
  const {
    state,
    reload,
    createConversation,
    isCreating,
    createError,
    renameConversation,
    deleteConversation,
    pendingConversationId,
    actionError,
  } = useConversations(client, accessToken, workspaceId);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  async function handleCreate(): Promise<void> {
    const created = await createConversation();
    if (created) {
      onCreated(created.id);
    }
  }

  function startRename(conversationId: string, currentTitle: string | null, createdAt: string): void {
    setRenamingId(conversationId);
    // Editing always starts from the conversation's real title, never
    // the display-only fallback (`formatConversationLabel`'s
    // "Conversation — <date>" text) — committing an untouched fallback
    // as a literal title would be a confusing, hard-to-undo surprise.
    setRenameDraft(currentTitle ?? formatConversationLabel(currentTitle, createdAt));
  }

  function cancelRename(): void {
    setRenamingId(null);
    setRenameDraft("");
  }

  async function commitRename(conversationId: string): Promise<void> {
    const title = renameDraft.trim();
    // An empty draft (the field cleared entirely) is treated as a
    // cancel, not a rejected submission — `renameConversationRequestSchema`
    // would reject it anyway, and silently reopening the field with an
    // inline error for an obviously-abandoned edit is worse UX than
    // just leaving the original title alone.
    if (title === "") {
      cancelRename();
      return;
    }
    setRenamingId(null);
    await renameConversation(conversationId, title);
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>, conversationId: string): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename(conversationId);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);
    const succeeded = await deleteConversation(id);
    if (succeeded) {
      onDeleted(id);
    }
  }

  return (
    <div className="omni-chat-conversation-panel">
      <div className="omni-chat-conversation-panel__header">
        <h2 className="omni-chat-conversation-panel__title">Conversations</h2>
        <Button size="sm" onClick={() => void handleCreate()} loading={isCreating}>
          New
        </Button>
      </div>

      {createError && (
        <Alert tone="error" title="Couldn't create conversation">
          {createError}
        </Alert>
      )}

      {actionError && (
        <Alert tone="error" title="Couldn't update conversation">
          {actionError}
        </Alert>
      )}

      {state.phase === "loading" && (
        <div className="omni-chat-conversation-panel__loading">
          <Spinner size="md" label="Loading conversations" />
        </div>
      )}

      {state.phase === "error" && (
        <ErrorState
          title="Couldn't load conversations"
          description={state.message}
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      )}

      {state.phase === "ready" && state.conversations.length === 0 && (
        <EmptyState
          title="No conversations yet"
          description="Start a new conversation to chat with the assistant."
          action={
            <Button size="sm" onClick={() => void handleCreate()} loading={isCreating}>
              New conversation
            </Button>
          }
        />
      )}

      {state.phase === "ready" && state.conversations.length > 0 && (
        <div className="omni-chat-conversation-list" aria-label="Conversation list">
          {state.conversations.map((conversation) => {
            const isActive = conversation.id === activeConversationId;
            const isRenamingThis = renamingId === conversation.id;
            const isPending = pendingConversationId === conversation.id;
            const label = formatConversationLabel(conversation.title, conversation.createdAt);
            // Deliberately not `Options for ${label}`: for an
            // untitled conversation, `label` is the "Conversation —
            // <date>" fallback text — the same substring several
            // existing tests (`ChatPanel.test.tsx`) match the select
            // button itself with via `/Conversation —/`. Reusing it
            // here would make `getByRole("button", { name: /Conversation —/ })`
            // ambiguously match both this menu trigger and the select
            // button. Using the conversation's real title (only when
            // one has actually been set) sidesteps that collision
            // entirely rather than special-casing the query strings.
            const menuLabel = conversation.title ? `Options for ${conversation.title}` : "Options for this conversation";

            if (isRenamingThis) {
              return (
                <div key={conversation.id} className="omni-chat-conversation-list-row">
                  <Input
                    ref={renameInputRef}
                    aria-label="Conversation title"
                    value={renameDraft}
                    disabled={isPending}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => handleRenameKeyDown(event, conversation.id)}
                    onBlur={() => void commitRename(conversation.id)}
                    className="omni-chat-conversation-list-row__rename-input"
                  />
                </div>
              );
            }

            return (
              <div key={conversation.id} className="omni-chat-conversation-list-row">
                <button
                  type="button"
                  className="omni-chat-conversation-list-item"
                  aria-current={isActive}
                  disabled={isPending}
                  onClick={() => onSelect(conversation.id)}
                >
                  {label}
                </button>
                <Dropdown
                  trigger={
                    <span
                      className="omni-chat-conversation-list-row__menu-trigger"
                      role="button"
                      tabIndex={0}
                      aria-label={menuLabel}
                    >
                      ⋮
                    </span>
                  }
                  items={[
                    {
                      key: "rename",
                      label: "Rename",
                      disabled: isPending,
                      onSelect: () => startRename(conversation.id, conversation.title, conversation.createdAt),
                    },
                    {
                      key: "delete",
                      label: "Delete",
                      disabled: isPending,
                      onSelect: () => setDeleteTarget({ id: conversation.id, label }),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete conversation?"
        description={
          deleteTarget
            ? `"${deleteTarget.label}" and all of its messages will be permanently deleted. This can't be undone.`
            : undefined
        }
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--omni-space-3)" }}>
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={pendingConversationId === deleteTarget?.id}
              onClick={() => void confirmDelete()}
            >
              Delete
            </Button>
          </div>
        }
      />
    </div>
  );
}
