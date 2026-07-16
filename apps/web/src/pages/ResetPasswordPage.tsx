import { useState, type FormEvent, type JSX } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { resetPasswordRequestSchema } from "@omniscience/schemas";
import { Alert, Button, Input, OtpInput, useToast } from "@omniscience/ui";
import { useAuth } from "../lib/auth/AuthContext";
import {
  getAuthErrorMessage,
  getFieldErrors,
  isAuthErrorCode,
  type FieldErrors,
} from "../lib/auth/authErrors";
import { validateWithSchema } from "../lib/auth/validateWithSchema";
import { AuthLayout } from "./auth/AuthLayout";

interface ResetPasswordLocationState {
  email?: string;
}

function isOtpError(error: unknown): boolean {
  return (
    isAuthErrorCode(error, "OTP_INCORRECT") ||
    isAuthErrorCode(error, "OTP_EXPIRED") ||
    isAuthErrorCode(error, "OTP_MAX_ATTEMPTS_EXCEEDED")
  );
}

export function ResetPasswordPage(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const initialEmail = (location.state as ResetPasswordLocationState | null)?.email ?? "";

  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [otpError, setOtpError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { client } = useAuth();
  const { showToast } = useToast();

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setOtpError(null);
    if (mismatch) return;

    const validation = validateWithSchema(resetPasswordRequestSchema, {
      email,
      otp,
      newPassword: password,
    });
    if (!validation.valid) {
      const { newPassword, otp: otpFieldError, ...rest } = validation.fieldErrors;
      setFieldErrors(newPassword ? { ...rest, password: newPassword } : rest);
      setOtpError(otpFieldError ?? null);
      return;
    }
    setFieldErrors({});

    if (!client) {
      setFormError("Password reset is unavailable right now — the API isn't configured.");
      return;
    }

    setSubmitting(true);
    try {
      await client.resetPassword(validation.data);
      showToast({
        tone: "success",
        title: "Password updated",
        description: "Your password has been reset — please sign in.",
      });
      navigate("/login");
    } catch (error) {
      if (isOtpError(error)) {
        setOtpError(getAuthErrorMessage(error));
      } else {
        setFieldErrors(getFieldErrors(error));
        setFormError(getAuthErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Enter the code we sent you along with your new password."
      footer={
        <>
          <Link to="/login">Back to sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}>
        {formError && (
          <Alert tone="error" title="Couldn't reset your password">
            {formError}
          </Alert>
        )}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          error={fieldErrors.email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <OtpInput value={otp} onChange={setOtp} error={otpError ?? undefined} label="Reset code" />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          helperText="At least 10 characters, with upper/lowercase, a number, and a symbol."
          value={password}
          error={fieldErrors.password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          error={mismatch ? "Passwords do not match" : undefined}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        <Button type="submit" fullWidth loading={submitting} disabled={mismatch}>
          Reset password
        </Button>
      </form>
    </AuthLayout>
  );
}
