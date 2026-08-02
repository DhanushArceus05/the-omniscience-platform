import { useCallback, useEffect, useState, type JSX } from "react";
import { Alert, Button, ErrorState, Skeleton } from "@omniscience/ui";
import { useAuth } from "../../lib/auth/AuthContext";
import { getChatErrorMessage } from "./chatErrors";
import { ChatComposer } from "./ChatComposer";
import { MessageList } from "./MessageList";
import { useMessageStream } from "./useMessageStream";

type HistoryState = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready" };

const UNCONFIGURED_MESSAGE = "Chat is unavailable right now — the API isn't configured.";

export interface ConversationThreadProps {
  workspaceId: string;
  conversationId: string;
}

/**
 * Renders one active conversation: loads its history
 * (`listMessages`), then hands off to `useMessageStream` for the
 * optimistic-send/streaming lifecycle. Re-created effect logic below
 * runs on every `conversationId` change (a new conversation selected,
 * or a workspace switch) — `stream.reset()` clears the previous
 * conversation's messages immediately (so nothing from conversation A
 * is briefly visible while conversation B's history is still loading),
 * and `useMessageStream` itself independently aborts any in-flight
 * stream for the previous conversation (see that hook's own cleanup
 * effect) — the two concerns are deliberately kept separate.
 */
export function ConversationThread({ workspaceId, conversationId }: ConversationThreadProps): JSX.Element {
  const { client, accessToken } = useAuth();
  const [historyState, setHistoryState] = useState<HistoryState>({ phase: "loading" });
  const stream = useMessageStream({ client, accessToken, workspaceId, conversationId });
  const { reset, hydrate } = stream;

  const loadHistory = useCallback(async () => {
    reset();
    setHistoryState({ phase: "loading" });
    if (!client || !accessToken) {
      setHistoryState({ phase: "error", message: UNCONFIGURED_MESSAGE });
      return;
    }
    try {
      const result = await client.listMessages(accessToken, workspaceId, conversationId);
      hydrate(result.messages);
      setHistoryState({ phase: "ready" });
    } catch (error) {
      setHistoryState({ phase: "error", message: getChatErrorMessage(error) });
    }
  }, [client, accessToken, workspaceId, conversationId, reset, hydrate]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  if (historyState.phase === "loading") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }} aria-busy="true" aria-label="Loading conversation">
        <Skeleton height="3rem" width="60%" />
        <Skeleton height="3rem" width="45%" />
        <Skeleton height="3rem" width="70%" />
      </div>
    );
  }

  if (historyState.phase === "error") {
    return (
      <ErrorState
        title="Couldn't load this conversation"
        description={historyState.message}
        action={
          <Button variant="secondary" onClick={() => void loadHistory()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "var(--omni-space-4)" }}>
      <MessageList messages={stream.messages} />

      {stream.streamError && (
        <Alert tone="error" title="Something went wrong">
          <p style={{ margin: "0 0 var(--omni-space-2)" }}>{stream.streamError}</p>
          <Button size="sm" variant="secondary" onClick={stream.retry}>
            Retry
          </Button>
        </Alert>
      )}

      <ChatComposer
        onSend={stream.sendMessage}
        onStop={stream.stopStreaming}
        isStreaming={stream.isStreaming}
      />
    </div>
  );
}
