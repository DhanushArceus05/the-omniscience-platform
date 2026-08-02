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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: "var(--omni-text-md)" }}>Conversations</h2>
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
        <div style={{ display: "flex", justifyContent: "center", padding: "var(--omni-space-6)" }}>
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
        <div
          style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-2)", overflowY: "auto" }}
          aria-label="Conversation list"
        >
          {state.conversations.map((conversation) => {
            const isActive = conversation.id === activeConversationId;
            return (
              <button
                key={conversation.id}
                type="button"
                className="omni-card omni-chat-conversation-list-item"
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
