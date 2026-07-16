import { useState, type JSX } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, OtpInput, useToast } from "@omniscience/ui";
import { useAuth } from "../lib/auth/AuthContext";
import { getAuthErrorMessage, isAuthErrorCode } from "../lib/auth/authErrors";
import { AuthLayout } from "./auth/AuthLayout";

interface VerifyOtpLocationState {
  email?: string;
}

export function VerifyOtpPage(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const email = (location.state as VerifyOtpLocationState | null)?.email;

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { client } = useAuth();
  const { showToast } = useToast();

  if (!email) {
    return (
      <AuthLayout
        title="Verify your email"
        subtitle="We couldn't find a registration in progress."
        footer={
          <>
            <Link to="/register">Back to register</Link>
          </>
        }
      >
        <Alert tone="warning" title="Start again">
          Please register again so we can send you a fresh verification code.
        </Alert>
      </AuthLayout>
    );
  }

  async function handleVerify(otpValue: string = code): Promise<void> {
    setOtpError(null);
    setFormError(null);

    if (!client) {
      setFormError("Verification is unavailable right now — the API isn't configured.");
      return;
    }

    setSubmitting(true);
    try {
      await client.verifyOtp({ email: email as string, otp: otpValue });
      showToast({
        tone: "success",
        title: "Email verified",
        description: "Your account is ready — please sign in.",
      });
      navigate("/login");
    } catch (error) {
      if (
        isAuthErrorCode(error, "OTP_INCORRECT") ||
        isAuthErrorCode(error, "OTP_EXPIRED") ||
        isAuthErrorCode(error, "OTP_MAX_ATTEMPTS_EXCEEDED")
      ) {
        setOtpError(getAuthErrorMessage(error));
      } else {
        setFormError(getAuthErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend(): Promise<void> {
    setFormError(null);
    if (!client) {
      setFormError("Resending is unavailable right now — the API isn't configured.");
      return;
    }

    setResending(true);
    try {
      await client.resendOtp({ email: email as string });
      showToast({
        tone: "success",
        title: "Code resent",
        description: `Check ${email} for your new verification code.`,
      });
      setCode("");
      setOtpError(null);
    } catch (error) {
      setFormError(getAuthErrorMessage(error));
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={`Enter the 6-digit code we've sent to ${email}.`}
      footer={
        <>
          Didn&apos;t get a code?{" "}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
              color: "var(--omni-color-accent)",
              cursor: resending ? "not-allowed" : "pointer",
              textDecoration: "underline",
            }}
          >
            {resending ? "Resending…" : "Resend"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-6)" }}>
        {formError && (
          <Alert tone="error" title="Something went wrong">
            {formError}
          </Alert>
        )}
        <OtpInput value={code} onChange={setCode} onComplete={handleVerify} error={otpError ?? undefined} />
        <Button fullWidth loading={submitting} disabled={code.length < 6} onClick={() => void handleVerify()}>
          Verify
        </Button>
      </div>
    </AuthLayout>
  );
}
