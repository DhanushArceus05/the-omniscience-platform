import { useState, type JSX } from "react";
import { ConversationSidebar } from "./ConversationSidebar";
import { ConversationThread } from "./ConversationThread";
import { EmptyState } from "@omniscience/ui";

export interface ChatPanelProps {
  workspaceId: string;
}

/**
 * The full chat experience for one workspace: a conversation
 * sidebar/switcher on the left, the active conversation's thread on
 * the right. Owns exactly one piece of state — which conversation is
 * currently selected — and leaves everything else (loading history,
 * streaming, creating/listing conversations) to the child components/
 * hooks that already encapsulate it.
 *
 * Switching `activeConversationId` unmounts the previous
 * `ConversationThread` and mounts a new one (keyed by conversation id)
 * rather than passing a changing `conversationId` prop into a single
 * long-lived instance — this guarantees a full, clean reset of that
 * conversation's local component state on switch, on top of (not
 * instead of) `useMessageStream`'s own cleanup-on-change effect and
 * `ConversationThread`'s own history-reset-on-change effect.
 */
export function ChatPanel({ workspaceId }: ChatPanelProps): JSX.Element {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "260px 1fr",
        gap: "var(--omni-space-6)",
        height: "calc(100vh - 220px)",
        minHeight: "480px",
      }}
    >
      <ConversationSidebar
        workspaceId={workspaceId}
        activeConversationId={activeConversationId}
        onSelect={setActiveConversationId}
        onCreated={setActiveConversationId}
      />

      <div style={{ minWidth: 0, height: "100%" }}>
        {activeConversationId ? (
          <ConversationThread key={activeConversationId} workspaceId={workspaceId} conversationId={activeConversationId} />
        ) : (
          <EmptyState
            title="Select a conversation"
            description="Choose a conversation on the left, or start a new one, to begin chatting."
          />
        )}
      </div>
    </div>
  );
}
