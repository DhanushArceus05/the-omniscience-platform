import type { JSX, ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Spinner } from "@omniscience/ui";
import { useAuth } from "./AuthContext";

/**
 * Phase 3 Step 1 — guards a route behind a confirmed, backend-verified
 * session.
 *
 * Deliberately keyed off `authStatus` (`"loading" | "authenticated" |
 * "unauthenticated"`) rather than a plain `isAuthenticated` boolean: while
 * `AuthContext` is still verifying (or refreshing) a persisted session
 * against `/auth/me`, a boolean can't distinguish "not logged in" from
 * "haven't checked yet", which would redirect a genuinely logged-in user
 * to `/login` for one render on every page load/refresh. Rendering a
 * loading state instead and only redirecting once bootstrap has
 * definitively finished avoids that flash.
 */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { authStatus } = useAuth();
  const location = useLocation();

  if (authStatus === "loading") {
    return <AuthBootstrapLoadingState />;
  }

  if (authStatus === "unauthenticated") {
    // Carries the originally-requested location so LoginPage can return
    // the user here after a successful sign-in, instead of always
    // dropping them at the default /app landing spot.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

function AuthBootstrapLoadingState(): JSX.Element {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Spinner size="lg" label="Checking your session" />
    </div>
  );
}
