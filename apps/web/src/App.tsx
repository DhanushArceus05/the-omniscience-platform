import type { JSX } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { RouteTransition, ToastProvider } from "@omniscience/ui";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { VerifyOtpPage } from "./pages/VerifyOtpPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AppShellPreviewPage } from "./pages/AppShellPreviewPage";
import { NotFoundPage } from "./pages/NotFoundPage";

/**
 * Phase 1 root: premium UI foundation only — routing between static
 * screens, no backend/auth/API wiring beyond the Phase 0 health
 * widget embedded in AppShellPreviewPage. Real authentication lands
 * in Phase 2 and dashboard/workspace logic in Phase 3.
 */
export function App(): JSX.Element {
  const location = useLocation();

  return (
    <ToastProvider>
      <RouteTransition routeKey={location.pathname}>
        <Routes location={location}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-otp" element={<VerifyOtpPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/app" element={<AppShellPreviewPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </RouteTransition>
    </ToastProvider>
  );
}
