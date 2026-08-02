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
}

/**
 * Loads and creates conversations for one workspace — mirrors
 * `WorkspaceDashboard`'s existing list/create shape (a single bounded
 * page, prepend-on-create rather than a full re-fetch). Selecting
 * which conversation is active is deliberately out of this hook's
 * scope — see `ChatPanel`, which owns that as plain component state so
 * this hook stays focused and independently testable.
 */
export function useConversations(
  client: OmniscienceClient | null,
  accessToken: string | null,
  workspaceId: string,
): UseConversationsResult {
  const [state, setState] = useState<ConversationsLoadState>({ phase: "loading" });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  return { state, reload: () => void load(), createConversation, isCreating, createError };
}
