import { useEffect, useRef, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, useBodyScrollLock, useMediaQuery } from "@omniscience/ui";
import { ConversationSidebar } from "./ConversationSidebar";
import { ConversationThread } from "./ConversationThread";
import "./chat.css";

export interface ChatPanelProps {
  workspaceId: string;
  /**
   * The conversation id from the URL at mount time (Phase 6 Step 5
   * bugfix), or `null` if the route was opened without one. Used only
   * to seed the initial selection — after that, this component owns
   * the live value and keeps the URL in sync with it (see the
   * `navigate` calls below), rather than re-reading this prop on every
   * render, so `ChatPage`/`App.tsx`'s route params don't need to be
   * this component's source of truth for the entire session.
   */
  initialConversationId: string | null;
}

/**
 * Below this width the 260px-ish conversation sidebar can no longer sit
 * beside the message thread without squeezing it — the sidebar instead
 * becomes an off-canvas panel opened by a "Conversations" button. Kept
 * as its own constant (distinct from AppShell's 1024px nav breakpoint)
 * because the two panels are unrelated concepts: this one is about how
 * much horizontal room the *chat grid itself* has inside `<main>`, not
 * about the app's outer navigation.
 */
const COMPACT_CHAT_QUERY = "(max-width: 900px)";

/**
 * The full chat experience for one workspace: a conversation
 * sidebar/switcher and the active conversation's thread. Owns which
 * conversation is currently selected — seeded from `initialConversationId`,
 * then kept in sync with the URL's optional `:conversationId` segment via
 * `navigate(..., { replace: true })` on every change (Phase 6 Step 5
 * bugfix — a hard browser refresh previously always lost the selection,
 * since it lived only in this component's React state) — plus (compact
 * layouts only) whether the conversation panel is open, and leaves
 * everything else (loading history, streaming, creating/listing
 * conversations) to the child components/hooks that already encapsulate
 * it.
 *
 * Switching `activeConversationId` unmounts the previous
 * `ConversationThread` and mounts a new one (keyed by conversation id)
 * rather than passing a changing `conversationId` prop into a single
 * long-lived instance — this guarantees a full, clean reset of that
 * conversation's local component state on switch, on top of (not
 * instead of) `useMessageStream`'s own cleanup-on-change effect and
 * `ConversationThread`'s own history-reset-on-change effect.
 *
 * Layout: on a normal/desktop width this renders a CSS grid — a fluid
 * (not hardcoded) sidebar column beside the message thread, each an
 * independent scroll container (see chat.css) so a long conversation
 * history can never push the sidebar around. Below `COMPACT_CHAT_QUERY`
 * there is only ever *one* `ConversationSidebar` mounted at a time (not
 * a second copy hidden by CSS) — it moves into an off-canvas panel with
 * its own "Conversations" trigger button, its own scrim, its own
 * Escape/scroll-lock/focus handling, deliberately separate from (and
 * never overlapping) AppShell's own mobile navigation drawer, which
 * opens from the opposite edge of the screen.
 */
export function ChatPanel({ workspaceId, initialConversationId }: ChatPanelProps): JSX.Element {
  const navigate = useNavigate();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(initialConversationId);
  const [panelOpen, setPanelOpen] = useState(false);
  const isCompact = useMediaQuery(COMPACT_CHAT_QUERY);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useBodyScrollLock(isCompact && panelOpen);

  // A width change (rotation, resize across the breakpoint) while the
  // panel happened to be open must not strand it open once it's no
  // longer rendered as an overlay.
  useEffect(() => {
    if (!isCompact) setPanelOpen(false);
  }, [isCompact]);

  useEffect(() => {
    if (!isCompact || !panelOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setPanelOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isCompact, panelOpen]);

  useEffect(() => {
    const openAsOverlay = isCompact && panelOpen;
    if (openAsOverlay) {
      panelRef.current?.focus();
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      toggleButtonRef.current?.focus();
    }
  }, [isCompact, panelOpen]);

  /**
   * Selects `conversationId` (or clears the selection back to the
   * conversation-list view when `null`) and mirrors it into the URL —
   * `replace: true` so switching conversations doesn't spam the
   * back/forward history with one entry per switch, matching how a
   * live-updating list selection is expected to behave (unlike an
   * actual page navigation, which does want its own history entry).
   */
  function selectConversation(conversationId: string | null): void {
    setActiveConversationId(conversationId);
    navigate(
      conversationId
        ? `/app/workspace/${encodeURIComponent(workspaceId)}/chat/${encodeURIComponent(conversationId)}`
        : `/app/workspace/${encodeURIComponent(workspaceId)}/chat`,
      { replace: true },
    );
  }

  function handleSelect(conversationId: string): void {
    selectConversation(conversationId);
    setPanelOpen(false);
  }

  function handleCreated(conversationId: string): void {
    selectConversation(conversationId);
    setPanelOpen(false);
  }

  /**
   * Phase 6 Step 4 — called after any conversation is genuinely
   * deleted, not only the active one (see `ConversationSidebar`'s doc
   * comment on `onDeleted`). Only clears `activeConversationId` when
   * the deleted conversation was the one open — deleting a conversation
   * elsewhere in the list must not disturb whatever's currently
   * showing in `ConversationThread`.
   */
  function handleDeleted(conversationId: string): void {
    if (activeConversationId === conversationId) {
      selectConversation(null);
    }
  }

  const overlayActive = isCompact && panelOpen;

  return (
    <div className="omni-chat-shell">
      {isCompact && (
        <div className="omni-chat-shell__toolbar">
          <button
            ref={toggleButtonRef}
            type="button"
            className="omni-chat-shell__conversations-toggle"
            aria-haspopup="dialog"
            aria-expanded={panelOpen}
            aria-controls="omni-chat-conversation-panel"
            onClick={() => setPanelOpen(true)}
          >
            <span aria-hidden="true">☰</span> Conversations
          </button>
        </div>
      )}

      {overlayActive && (
        <button
          type="button"
          className="omni-chat-shell__scrim"
          aria-label="Close conversations"
          onClick={() => setPanelOpen(false)}
        />
      )}

      <div
        id="omni-chat-conversation-panel"
        ref={panelRef}
        tabIndex={-1}
        className={`omni-chat-shell__sidebar${overlayActive ? " omni-chat-shell__sidebar--open" : ""}`}
        role={overlayActive ? "dialog" : undefined}
        aria-modal={overlayActive ? true : undefined}
        aria-label={overlayActive ? "Conversations" : undefined}
      >
        {isCompact && (
          <button
            type="button"
            className="omni-chat-shell__sidebar-close"
            aria-label="Close conversations"
            onClick={() => setPanelOpen(false)}
          >
            ×
          </button>
        )}
        <ConversationSidebar
          workspaceId={workspaceId}
          activeConversationId={activeConversationId}
          onSelect={handleSelect}
          onCreated={handleCreated}
          onDeleted={handleDeleted}
        />
      </div>

      <div className="omni-chat-shell__main">
        {activeConversationId ? (
          <ConversationThread key={activeConversationId} workspaceId={workspaceId} conversationId={activeConversationId} />
        ) : (
          <EmptyState
            title="Select a conversation"
            description="Choose a conversation, or start a new one, to begin chatting."
          />
        )}
      </div>
    </div>
  );
}
