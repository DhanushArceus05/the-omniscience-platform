import { useState, type FormEvent, type JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import { forgotPasswordRequestSchema } from "@omniscience/schemas";
import { Alert, Button, Input, useToast } from "@omniscience/ui";
import { useAuth } from "../lib/auth/AuthContext";
import { getAuthErrorMessage, getFieldErrors, type FieldErrors } from "../lib/auth/authErrors";
import { validateWithSchema } from "../lib/auth/validateWithSchema";
import { AuthLayout } from "./auth/AuthLayout";

export function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { client } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const validation = validateWithSchema(forgotPasswordRequestSchema, { email });
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    setFieldErrors({});

    if (!client) {
      setFormError("Password reset is unavailable right now — the API isn't configured.");
      return;
    }

    setSubmitting(true);
    try {
      await client.forgotPassword(validation.data);
      setSent(true);
      showToast({
        tone: "info",
        title: "Check your inbox",
        description: "If an account exists for that email, a reset code is on its way.",
      });
    } catch (error) {
      setFieldErrors(getFieldErrors(error));
      setFormError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="We'll send a reset code to your email."
      footer={
        <>
          Remembered it? <Link to="/login">Back to sign in</Link>
        </>
      }
    >
      {sent ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}>
          <Alert tone="success" title="Check your inbox">
            If an account exists for that email, a reset code is on its way.
          </Alert>
          <Button fullWidth onClick={() => navigate("/reset-password", { state: { email } })}>
            I have my code
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}>
          {formError && (
            <Alert tone="error" title="Something went wrong">
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
          <Button type="submit" fullWidth loading={submitting}>
            Send reset code
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
