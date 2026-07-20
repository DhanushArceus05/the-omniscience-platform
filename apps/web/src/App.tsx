import type { JSX } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { RouteTransition, ToastProvider } from "@omniscience/ui";
import { AuthProvider } from "./lib/auth/AuthContext";
import { ProtectedRoute } from "./lib/auth/ProtectedRoute";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { VerifyOtpPage } from "./pages/VerifyOtpPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AppShellPreviewPage } from "./pages/AppShellPreviewPage";
import { AccountSettingsPage } from "./pages/AccountSettingsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

/**
 * Phase 1 built the premium UI shell; Phase 2 (Steps 3–5) wired the five
 * auth screens below to the real `apps/api` `/auth/*` endpoints via
 * `AuthProvider` (see `lib/auth/AuthContext.tsx`) — no more preview-only
 * toasts. Phase 3 Step 1 adds `ProtectedRoute`: `/app` now requires a
 * backend-verified session (via `/auth/me`, refreshing once via
 * `/auth/refresh` if needed) instead of being reachable by anyone.
 * Dashboard/workspace logic beyond the existing `/app` shell preview
 * remains later-Phase-3 scope.
 */
export function App(): JSX.Element {
  const location = useLocation();

  return (
    <AuthProvider>
      <ToastProvider>
        <RouteTransition routeKey={location.pathname}>
          <Routes location={location}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/verify-otp" element={<VerifyOtpPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <AppShellPreviewPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/settings"
              element={
                <ProtectedRoute>
                  <AccountSettingsPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </RouteTransition>
      </ToastProvider>
    </AuthProvider>
  );
}
