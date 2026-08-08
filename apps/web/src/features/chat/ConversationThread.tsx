import { useCallback, useEffect, useState, type JSX } from "react";
import { Alert, Button, ErrorState, Skeleton } from "@omniscience/ui";
import type { Message } from "@omniscience/types";
import { MAX_MESSAGE_LIST_LIMIT } from "@omniscience/schemas";
import { useAuth } from "../../lib/auth/AuthContext";
import { getChatErrorMessage } from "./chatErrors";
import { ChatComposer } from "./ChatComposer";
import { MessageList } from "./MessageList";
import { useMessageStream } from "./useMessageStream";

type HistoryState = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready" };

const UNCONFIGURED_MESSAGE = "Chat is unavailable right now — the API isn't configured.";

/**
 * A defensive circuit breaker on the pagination loop below — at
 * `MAX_MESSAGE_LIST_LIMIT` (50) messages per page, this is 500 messages,
 * far beyond anything a real conversation should reach. Guards against
 * an unforeseen server bug (e.g. a cursor that never advances) turning
 * into an infinite loop rather than a visible error.
 */
const MAX_HISTORY_PAGES = 10;

export interface ConversationThreadProps {
  workspaceId: string;
  conversationId: string;
}

/**
 * Renders one active conversation: loads its **complete** history
 * (`listMessages`, following `nextCursor` until exhausted — see the
 * loop in `loadHistory` below), then hands off to `useMessageStream`
 * for the optimistic-send/streaming lifecycle. Re-created effect logic
 * below runs on every `conversationId` change (a new conversation
 * selected, or a workspace switch) — `stream.reset()` clears the
 * previous conversation's messages immediately (so nothing from
 * conversation A is briefly visible while conversation B's history is
 * still loading), and `useMessageStream` itself independently aborts
 * any in-flight stream for the previous conversation (see that hook's
 * own cleanup effect) — the two concerns are deliberately kept
 * separate.
 *
 * **Full-history loading, not a single bounded page.** An earlier
 * version of this component called `listMessages()` exactly once with
 * no `cursor`, which only ever returns the *oldest*
 * `DEFAULT_MESSAGE_LIST_LIMIT` (20) messages — for any conversation
 * that grew past that, every reload silently showed the same stale
 * oldest slice, missing every message added since, and
 * `MessageList`'s "is this the true last message" eligibility for
 * regenerate/edit was computed against that truncated list, so it
 * disagreed with the server's actual last message and the guarded
 * delete correctly (but confusingly) rejected with `409
 * MESSAGE_NOT_LAST`. Following `nextCursor` to completion here fixes
 * both: the full, real history is what's ever hydrated, so its last
 * element always matches what `deleteMessage()` will independently
 * re-derive server-side.
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
      const messages: Message[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
        const result = await client.listMessages(accessToken, workspaceId, conversationId, {
          limit: MAX_MESSAGE_LIST_LIMIT,
          cursor,
        });
        messages.push(...result.messages);
        if (!result.nextCursor) {
          break;
        }
        cursor = result.nextCursor;
      }
      hydrate(messages);
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
      <div className="omni-chat-thread" aria-busy="true" aria-label="Loading conversation">
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
    <div className="omni-chat-thread">
      <div className="omni-chat-thread__scroll-region">
        <MessageList
          messages={stream.messages}
          onRegenerate={stream.regenerateLastAssistantMessage}
          onEditSave={stream.editLastUserMessage}
        />
      </div>

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
