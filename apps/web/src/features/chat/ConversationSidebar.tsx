import type { JSX } from "react";
import { Alert, Button, EmptyState, ErrorState, Spinner } from "@omniscience/ui";
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
}

/**
 * The conversation list/switcher for one workspace's chat page. Loading,
 * creating, and selecting are all scoped to this one workspace — there
 * is deliberately no cross-workspace or global chat entry point (see
 * `ChatPage`'s doc comment).
 *
 * The conversation list below is its own independent scroll container
 * (`flex: 1; min-height: 0; overflow-y: auto` — see chat.css's
 * `.omni-chat-conversation-list`) so a long list of conversations can
 * never push this panel's header/"New" button out of view, and adding
 * messages to the active conversation (rendered entirely elsewhere, in
 * `ConversationThread`) can never move this sidebar.
 */
export function ConversationSidebar({
  workspaceId,
  activeConversationId,
  onSelect,
  onCreated,
}: ConversationSidebarProps): JSX.Element {
  const { client, accessToken } = useAuth();
  const { state, reload, createConversation, isCreating, createError } = useConversations(
    client,
    accessToken,
    workspaceId,
  );

  async function handleCreate(): Promise<void> {
    const created = await createConversation();
    if (created) {
      onCreated(created.id);
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
            return (
              <button
                key={conversation.id}
                type="button"
                className="omni-chat-conversation-list-item"
                aria-current={isActive}
                onClick={() => onSelect(conversation.id)}
              >
                {formatConversationLabel(conversation.title, conversation.createdAt)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
