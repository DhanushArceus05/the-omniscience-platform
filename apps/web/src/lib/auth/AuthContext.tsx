import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { ApiClientError, OmniscienceClient } from "@omniscience/sdk";
import type { AuthenticatedUser, LoginResponse } from "@omniscience/types";

const STORAGE_KEY = "omniscience.auth.session";

/**
 * Everything persisted for a signed-in session, in one key (see the
 * artifact/storage guidance elsewhere in this codebase: group data that's
 * read/written together instead of splitting it across multiple keys).
 * The access token is a short-lived JWT (`accessTokenExpiresAt`); the
 * refresh token is the opaque, Redis-backed secret from Step 4/7. Neither
 * is ever sent anywhere except as the `Authorization`/body value the
 * matching `/auth/*` endpoint expects.
 */
interface StoredSession {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: AuthenticatedUser;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user) return null;
    return parsed as StoredSession;
  } catch {
    // Corrupt or inaccessible storage (private browsing, disabled
    // localStorage, hand-edited value) is treated as "no session" rather
    // than crashing the app on load.
    return null;
  }
}

function writeStoredSession(session: StoredSession | null): void {
  try {
    if (session) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Best-effort persistence only — if storage is unavailable, the
    // session still works in-memory for the current tab/reload.
  }
}

function toStoredSession(login: LoginResponse): StoredSession {
  const now = Date.now();
  return {
    accessToken: login.accessToken,
    accessTokenExpiresAt: new Date(now + login.accessTokenExpiresInSeconds * 1000).toISOString(),
    refreshToken: login.refreshToken,
    refreshTokenExpiresAt: new Date(now + login.refreshTokenExpiresInSeconds * 1000).toISOString(),
    user: login.user,
  };
}

/**
 * Builds the SDK client from Vite env vars, mirroring
 * `SystemStatusPanel`'s `createClient` exactly: never throws, so a
 * missing `VITE_API_BASE_URL`/`VITE_AI_SERVICE_BASE_URL` degrades to a
 * `configError` state instead of crashing the whole app before React
 * ever renders.
 */
function createClient(): OmniscienceClient | null {
  try {
    return new OmniscienceClient({
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
      aiServiceBaseUrl: import.meta.env.VITE_AI_SERVICE_BASE_URL,
    });
  } catch {
    return null;
  }
}

/**
 * Phase 3 Step 1 — the three states of the auth bootstrap. `ProtectedRoute`
 * (`./ProtectedRoute`) reads this instead of a plain boolean so it can
 * distinguish "we don't know yet" (render a loading state, never redirect)
 * from "confirmed logged out" (redirect to `/login`).
 */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  /** The typed SDK client, or `null` if the API base URL isn't configured. */
  client: OmniscienceClient | null;
  /** True when `client` is `null` — the API base URL isn't configured. */
  configError: boolean;
  user: AuthenticatedUser | null;
  /**
   * The current access token, or `null` when not authenticated.
   * Phase 3 Step 2 introduces the first in-page authenticated calls
   * (`listWorkspaces`/`createWorkspace`/`getWorkspace`) that need this
   * directly, rather than only at bootstrap. There is deliberately no
   * accompanying refresh-and-retry helper here yet — see
   * `WorkspaceDashboard`'s docstring for why that's still a documented
   * future step, not part of this one.
   */
  accessToken: string | null;
  /**
   * `"loading"` until the initial bootstrap (verify-or-refresh any
   * persisted session against the backend) finishes; `"authenticated"` or
   * `"unauthenticated"` after. Prefer this over `isAuthenticated` for any
   * decision that must not act before bootstrap completes (e.g. route
   * guarding) — `isAuthenticated` alone can't tell "not logged in" apart
   * from "haven't checked yet".
   */
  authStatus: AuthStatus;
  /** Convenience alias for `authStatus === "loading"`. */
  isInitializing: boolean;
  /** Convenience alias for `authStatus === "authenticated"`. */
  isAuthenticated: boolean;
  /** Persists a successful `login()` response (tokens + user) locally. */
  setSession: (login: LoginResponse) => void;
  /**
   * Phase 3 Step 3 — merges a partial `AuthenticatedUser` patch into the
   * current session's cached `user` (e.g. after a successful
   * `updateProfile`/`uploadAvatar`/`deleteAvatar` call) and persists it,
   * so the TopBar/UserMenu name and avatar update immediately without a
   * page reload. Intentionally the *only* new capability this step
   * adds here — it merges, it never re-verifies against the backend or
   * touches `authStatus`/tokens, so it can't weaken session-bootstrap
   * or logout in any way. A no-op if there's no active session.
   */
  updateUser: (patch: Partial<AuthenticatedUser>) => void;
  /**
   * Rotates the current session's tokens via `POST /auth/refresh`, persists
   * the result, and resolves the new access token — or resolves `null` and
   * clears the session (flipping `authStatus` to `"unauthenticated"`) if the
   * refresh token itself is no longer valid. Concurrent callers within the
   * same tab share a single in-flight refresh request rather than each
   * racing to consume the same single-use refresh token (only one would
   * ever succeed — see the in-flight-promise guard in `AuthProvider`).
   * `AuthProvider` already calls this proactively, shortly before the
   * access token's own expiry, so components generally don't need to call
   * it themselves — it's exposed mainly as a manual fallback for a
   * data-fetching hook that wants to retry once after an unexpected 401.
   */
  refreshAccessToken: () => Promise<string | null>;
  /** Best-effort server-side revocation, then always clears the local session. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const client = useMemo(createClient, []);
  const [session, setSessionState] = useState<StoredSession | null>(readStoredSession);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(() =>
    readStoredSession() ? "loading" : "unauthenticated",
  );

  // Guards the bootstrap network call itself against running twice — React
  // 18 StrictMode intentionally mounts, cleans up, and remounts every
  // component once in development specifically to surface effects that
  // aren't idempotent. Without this ref, that remount would fire a second
  // /auth/me (and potentially a second /auth/refresh, which would try to
  // use an already-rotated-and-discarded refresh token and spuriously log
  // the user out). The ref survives the StrictMode unmount/remount cycle
  // because the component instance itself is not recreated.
  const bootstrapped = useRef(false);

  // Guards *applying* the bootstrap's result, not starting it — see the
  // effect below for why this can't be a `cancelled` flag captured once
  // per effect invocation (that shape has a StrictMode deadlock: the
  // synthetic first cleanup sets it permanently, and the second effect
  // run is a no-op because `bootstrapped` above already blocks it, so the
  // one real result is silently discarded and authStatus never leaves
  // "loading"). Resetting this ref to `true` at the *start* of every
  // effect invocation — including the StrictMode remount — means that by
  // the time the in-flight promise from the first mount resolves, the
  // remount has already put it back to `true`.
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    async function bootstrap(startingSession: StoredSession, activeClient: OmniscienceClient): Promise<void> {
      try {
        const me = await activeClient.getMe(startingSession.accessToken);
        if (!isMounted.current) return;
        const confirmed: StoredSession = { ...startingSession, user: me };
        writeStoredSession(confirmed);
        setSessionState(confirmed);
        setAuthStatus("authenticated");
        return;
      } catch (error) {
        if (!isMounted.current) return;

        const isExpiredOrUnauthorized = error instanceof ApiClientError && error.status === 401;
        if (!isExpiredOrUnauthorized) {
          // A network failure or unexpected server error doesn't tell us
          // the session itself is invalid — but it also can't be
          // confirmed valid right now. Fail closed (treat as logged out
          // for this load) without destroying the persisted tokens, so a
          // reload once the backend/network is reachable again can still
          // succeed.
          setAuthStatus("unauthenticated");
          return;
        }
      }

      // Access token is expired/invalid per the backend (401). Attempt
      // exactly one refresh-and-retry — never more than once per
      // bootstrap, so a persistently-invalid refresh token can't loop.
      try {
        const refreshed = await activeClient.refresh({ refreshToken: startingSession.refreshToken });
        if (!isMounted.current) return;

        const now = Date.now();
        const rotated: StoredSession = {
          accessToken: refreshed.accessToken,
          accessTokenExpiresAt: new Date(
            now + refreshed.accessTokenExpiresInSeconds * 1000,
          ).toISOString(),
          refreshToken: refreshed.refreshToken,
          refreshTokenExpiresAt: new Date(
            now + refreshed.refreshTokenExpiresInSeconds * 1000,
          ).toISOString(),
          user: startingSession.user,
        };
        // Persist the rotated tokens immediately — the old refresh token
        // was single-use and is already burned server-side, so if the
        // retried /auth/me below fails for any other reason, the rotated
        // pair (not the now-dead original) is what a future reload sees.
        writeStoredSession(rotated);
        setSessionState(rotated);

        const me = await activeClient.getMe(rotated.accessToken);
        if (!isMounted.current) return;
        const confirmed: StoredSession = { ...rotated, user: me };
        writeStoredSession(confirmed);
        setSessionState(confirmed);
        setAuthStatus("authenticated");
      } catch {
        if (!isMounted.current) return;
        // Refresh itself failed, or the retried /auth/me still failed —
        // either way the session cannot be salvaged. Clear everything and
        // mark the user unauthenticated.
        writeStoredSession(null);
        setSessionState(null);
        setAuthStatus("unauthenticated");
      }
    }

    if (!bootstrapped.current) {
      bootstrapped.current = true;

      const initialSession = readStoredSession();
      if (!initialSession) {
        // Nothing persisted — already "unauthenticated" from initial
        // state, nothing to verify.
      } else if (!client) {
        // A persisted session exists but there's no way to verify it
        // against the backend (missing API config). Trusting it
        // unverified would mean granting access on the client's say-so
        // alone, so it's discarded instead — the backend remains the
        // sole source of truth for whether a session is valid.
        writeStoredSession(null);
        setSessionState(null);
        setAuthStatus("unauthenticated");
      } else {
        void bootstrap(initialSession, client);
      }
    }

    return () => {
      isMounted.current = false;
    };
  }, [client]);

  const setSession = useCallback((login: LoginResponse) => {
    const stored = toStoredSession(login);
    writeStoredSession(stored);
    setSessionState(stored);
    setAuthStatus("authenticated");
  }, []);

  // Deduplicates concurrent refresh attempts (e.g. the proactive timer
  // below firing at roughly the same moment a data-fetching hook hits a
  // 401 and retries manually): the refresh token is single-use/rotating
  // (Step 4/7), so two independent `POST /auth/refresh` calls racing for
  // the same stored refresh token would let only one succeed and the
  // other spuriously log the user out. Every caller within this tab
  // during a given refresh instead shares the one in-flight promise.
  const refreshInFlightRef = useRef<Promise<string | null> | null>(null);

  const refreshAccessToken = useCallback((): Promise<string | null> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    if (!client) return Promise.resolve(null);

    const current = readStoredSession();
    if (!current) return Promise.resolve(null);

    const attempt = (async (): Promise<string | null> => {
      try {
        const refreshed = await client.refresh({ refreshToken: current.refreshToken });
        const now = Date.now();
        const rotated: StoredSession = {
          accessToken: refreshed.accessToken,
          accessTokenExpiresAt: new Date(
            now + refreshed.accessTokenExpiresInSeconds * 1000,
          ).toISOString(),
          refreshToken: refreshed.refreshToken,
          refreshTokenExpiresAt: new Date(
            now + refreshed.refreshTokenExpiresInSeconds * 1000,
          ).toISOString(),
          user: current.user,
        };
        writeStoredSession(rotated);
        setSessionState(rotated);
        setAuthStatus("authenticated");
        return rotated.accessToken;
      } catch {
        // The refresh token itself is invalid/expired/already used — the
        // session genuinely cannot be salvaged. Clear it so
        // `ProtectedRoute` redirects to `/login` instead of the app being
        // left silently unable to load any authenticated data.
        writeStoredSession(null);
        setSessionState(null);
        setAuthStatus("unauthenticated");
        return null;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = attempt;
    return attempt;
  }, [client]);

  // Proactive refresh: schedules a single-shot timer to refresh the access
  // token shortly *before* it expires, rather than only ever reacting to a
  // 401 after the fact. This is what fixes "workspace list / conversation
  // list suddenly says session expired a few minutes after login" — an
  // in-page data fetch (e.g. `WorkspaceDashboard.loadWorkspaces`) never had
  // any 401-refresh-and-retry of its own (a documented gap — see that
  // component's docstring), so once the short-lived access token expired
  // mid-session, every subsequent authenticated request failed with 401
  // until the person manually reloaded the page (which re-runs
  // `ProtectedRoute`'s own bootstrap-time refresh). Refreshing ahead of
  // expiry means the token in `session` is (almost) never actually expired
  // while the app is open, so this class of failure shouldn't occur at all
  // in normal use. Re-runs (and reschedules against the new expiry) every
  // time `session`/`authStatus` change, so this is self-perpetuating for
  // as long as the user stays signed in.
  useEffect(() => {
    if (authStatus !== "authenticated" || !session) return;

    const REFRESH_MARGIN_MS = 60_000;
    const MIN_DELAY_MS = 1_000;
    const expiresAt = new Date(session.accessTokenExpiresAt).getTime();
    const delay = Math.max(expiresAt - Date.now() - REFRESH_MARGIN_MS, MIN_DELAY_MS);

    const timerId = window.setTimeout(() => {
      void refreshAccessToken();
    }, delay);

    return () => window.clearTimeout(timerId);
  }, [authStatus, session, refreshAccessToken]);

  const updateUser = useCallback((patch: Partial<AuthenticatedUser>) => {
    setSessionState((previous) => {
      if (!previous) return previous;
      const updated: StoredSession = { ...previous, user: { ...previous.user, ...patch } };
      writeStoredSession(updated);
      return updated;
    });
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = session?.refreshToken;
    writeStoredSession(null);
    setSessionState(null);
    setAuthStatus("unauthenticated");
    if (client && refreshToken) {
      try {
        await client.logout({ refreshToken });
      } catch {
        // The local session is already cleared either way; failing to
        // revoke server-side (e.g. offline) shouldn't block sign-out.
      }
    }
  }, [client, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      client,
      configError: client === null,
      user: session?.user ?? null,
      accessToken: session?.accessToken ?? null,
      authStatus,
      isInitializing: authStatus === "loading",
      isAuthenticated: authStatus === "authenticated",
      setSession,
      updateUser,
      refreshAccessToken,
      logout,
    }),
    [client, session, authStatus, setSession, updateUser, refreshAccessToken, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
