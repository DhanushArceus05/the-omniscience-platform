import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { OmniscienceClient } from "@omniscience/sdk";
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

export interface AuthContextValue {
  /** The typed SDK client, or `null` if the API base URL isn't configured. */
  client: OmniscienceClient | null;
  /** True when `client` is `null` — the API base URL isn't configured. */
  configError: boolean;
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
  /** Persists a successful `login()` response (tokens + user) locally. */
  setSession: (login: LoginResponse) => void;
  /** Best-effort server-side revocation, then always clears the local session. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const client = useMemo(createClient, []);
  const [session, setSessionState] = useState<StoredSession | null>(readStoredSession);

  const setSession = useCallback((login: LoginResponse) => {
    const stored = toStoredSession(login);
    writeStoredSession(stored);
    setSessionState(stored);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = session?.refreshToken;
    writeStoredSession(null);
    setSessionState(null);
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
      isAuthenticated: session !== null,
      setSession,
      logout,
    }),
    [client, session, setSession, logout],
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
