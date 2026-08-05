import { useCallback, useEffect, useState } from "react";
import type { OmniscienceClient } from "@omniscience/sdk";
import type { Conversation } from "@omniscience/types";
import { getChatErrorMessage } from "./chatErrors";

export type ConversationsLoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; conversations: Conversation[] };

const UNCONFIGURED_MESSAGE = "Conversations are unavailable right now — the API isn't configured.";

export interface UseConversationsResult {
  state: ConversationsLoadState;
  reload: () => void;
  /** Creates a new conversation and prepends it to the list (it is always the newest) — returns it so the caller can select it immediately. */
  createConversation: () => Promise<Conversation | null>;
  isCreating: boolean;
  createError: string | null;
  /**
   * Renames a conversation in place (Phase 6 Step 4). Updates local
   * state optimistically — the new title is visible immediately,
   * before the request resolves — and rolls back to the previous
   * title if the request fails. Returns whether it succeeded.
   */
  renameConversation: (conversationId: string, title: string) => Promise<boolean>;
  /**
   * Deletes a conversation (Phase 6 Step 4). Removes it from local
   * state optimistically, re-inserting it at its original position if
   * the request fails. Returns whether it succeeded — the caller
   * (`ConversationSidebar`, via `ChatPanel`) uses this to know whether
   * to clear/redirect away from a currently-open conversation.
   */
  deleteConversation: (conversationId: string) => Promise<boolean>;
  /** The id of whichever conversation a rename/delete is currently in flight for, or `null` — lets the UI disable just that row's controls rather than the whole list. */
  pendingConversationId: string | null;
  /** The error from the most recent rename/delete attempt, if any. Cleared at the start of the next rename/delete attempt. */
  actionError: string | null;
}

/**
 * Loads, creates, renames, and deletes conversations for one workspace
 * — mirrors `WorkspaceDashboard`'s existing list/create shape for
 * loading/creating (a single bounded page, prepend-on-create rather
 * than a full re-fetch); rename/delete (Phase 6 Step 4) update local
 * state optimistically and roll back to the pre-call state on
 * failure, rather than re-fetching the whole list on every action.
 * Selecting which conversation is active is deliberately out of this
 * hook's scope — see `ChatPanel`, which owns that as plain component
 * state so this hook stays focused and independently testable.
 */
export function useConversations(
  client: OmniscienceClient | null,
  accessToken: string | null,
  workspaceId: string,
): UseConversationsResult {
  const [state, setState] = useState<ConversationsLoadState>({ phase: "loading" });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !accessToken) {
      setState({ phase: "error", message: UNCONFIGURED_MESSAGE });
      return;
    }
    setState({ phase: "loading" });
    try {
      const result = await client.listConversations(accessToken, workspaceId);
      setState({ phase: "ready", conversations: result.conversations });
    } catch (error) {
      setState({ phase: "error", message: getChatErrorMessage(error) });
    }
  }, [client, accessToken, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createConversation = useCallback(async (): Promise<Conversation | null> => {
    setCreateError(null);
    if (!client || !accessToken) {
      setCreateError(UNCONFIGURED_MESSAGE);
      return null;
    }
    setIsCreating(true);
    try {
      const created = await client.createConversation(accessToken, workspaceId);
      setState((previous) =>
        previous.phase === "ready"
          ? { phase: "ready", conversations: [created, ...previous.conversations] }
          : { phase: "ready", conversations: [created] },
      );
      return created;
    } catch (error) {
      setCreateError(getChatErrorMessage(error));
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [client, accessToken, workspaceId]);

  const renameConversation = useCallback(
    async (conversationId: string, title: string): Promise<boolean> => {
      setActionError(null);
      if (!client || !accessToken) {
        setActionError(UNCONFIGURED_MESSAGE);
        return false;
      }
      if (state.phase !== "ready") {
        return false;
      }

      // Read the pre-call title synchronously from `state` itself —
      // not from a variable mutated inside a `setState` updater and
      // read back afterwards. A functional updater's callback is not
      // guaranteed to run before the code immediately following the
      // `setState()` call (React schedules it), so that approach can
      // observe the rollback target as `undefined` by the time the
      // `catch` block runs — this hook is recreated on every `state`
      // change (`state` is a dependency below), so `state` here is
      // always this call's actual starting point.
      const target = state.conversations.find((conversation) => conversation.id === conversationId);
      const previousTitle = target ? target.title : null;

      // Optimistic: the new title is visible immediately.
      setState((current) =>
        current.phase === "ready"
          ? {
              phase: "ready",
              conversations: current.conversations.map((conversation) =>
                conversation.id === conversationId ? { ...conversation, title } : conversation,
              ),
            }
          : current,
      );

      setPendingConversationId(conversationId);
      try {
        const renamed = await client.renameConversation(accessToken, workspaceId, conversationId, title);
        setState((current) =>
          current.phase === "ready"
            ? {
                phase: "ready",
                conversations: current.conversations.map((conversation) =>
                  conversation.id === conversationId ? renamed : conversation,
                ),
              }
            : current,
        );
        return true;
      } catch (error) {
        // Roll back to the title that was showing before this call —
        // never assumed to be the server's very latest, just this
        // call's own known-good starting point.
        setState((current) =>
          current.phase === "ready"
            ? {
                phase: "ready",
                conversations: current.conversations.map((conversation) =>
                  conversation.id === conversationId ? { ...conversation, title: previousTitle } : conversation,
                ),
              }
            : current,
        );
        setActionError(getChatErrorMessage(error));
        return false;
      } finally {
        setPendingConversationId(null);
      }
    },
    [client, accessToken, workspaceId, state],
  );

  const deleteConversation = useCallback(
    async (conversationId: string): Promise<boolean> => {
      setActionError(null);
      if (!client || !accessToken) {
        setActionError(UNCONFIGURED_MESSAGE);
        return false;
      }
      if (state.phase !== "ready") {
        return false;
      }

      // Same reasoning as renameConversation() above: read the
      // pre-call position synchronously from `state` itself, not from
      // a variable mutated inside a `setState` updater — that pattern
      // races against React's own scheduling of when the updater
      // actually runs.
      const removedIndex = state.conversations.findIndex((conversation) => conversation.id === conversationId);
      if (removedIndex === -1) {
        return false;
      }
      const removed = state.conversations[removedIndex]!;

      // Optimistic: removed from the list immediately.
      setState((current) =>
        current.phase === "ready"
          ? {
              phase: "ready",
              conversations: current.conversations.filter((conversation) => conversation.id !== conversationId),
            }
          : current,
      );

      setPendingConversationId(conversationId);
      try {
        await client.deleteConversation(accessToken, workspaceId, conversationId);
        return true;
      } catch (error) {
        // Reinsert at its original index — never just at the top/end
        // of the list — same "restore this call's own known-good
        // starting point" reasoning as renameConversation() above.
        setState((current) => {
          if (current.phase !== "ready") return current;
          const conversations = [...current.conversations];
          conversations.splice(Math.min(removedIndex, conversations.length), 0, removed);
          return { phase: "ready", conversations };
        });
        setActionError(getChatErrorMessage(error));
        return false;
      } finally {
        setPendingConversationId(null);
      }
    },
    [client, accessToken, workspaceId, state],
  );

  return {
    state,
    reload: () => void load(),
    createConversation,
    isCreating,
    createError,
    renameConversation,
    deleteConversation,
    pendingConversationId,
    actionError,
  };
}
