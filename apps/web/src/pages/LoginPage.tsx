import { useState, type FormEvent, type JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loginRequestSchema } from "@omniscience/schemas";
import { Alert, Button, Input, useToast } from "@omniscience/ui";
import { useAuth } from "../lib/auth/AuthContext";
import {
  getAuthErrorMessage,
  getFieldErrors,
  isAuthErrorCode,
  type FieldErrors,
} from "../lib/auth/authErrors";
import { validateWithSchema } from "../lib/auth/validateWithSchema";
import { AuthLayout } from "./auth/AuthLayout";

export function LoginPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { client, setSession } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const validation = validateWithSchema(loginRequestSchema, { email, password });
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    setFieldErrors({});

    if (!client) {
      setFormError("Sign-in is unavailable right now — the API isn't configured.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await client.login(validation.data);
      setSession(result);
      showToast({
        tone: "success",
        title: "Welcome back",
        description: `Signed in as ${result.user.name}.`,
      });
      navigate("/app");
    } catch (error) {
      if (isAuthErrorCode(error, "EMAIL_NOT_VERIFIED")) {
        showToast({
          tone: "info",
          title: "Email not verified",
          description: "Enter the verification code we sent you to finish setting up your account.",
        });
        navigate("/verify-otp", { state: { email: validation.data.email } });
        return;
      }
      setFieldErrors(getFieldErrors(error));
      setFormError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue to your workspace."
      footer={
        <>
          Don&apos;t have an account? <Link to="/register">Create one</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}>
        {formError && (
          <Alert tone="error" title="Couldn't sign you in">
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
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          error={fieldErrors.password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Link to="/forgot-password" style={{ fontSize: "var(--omni-text-sm)" }}>
            Forgot password?
          </Link>
        </div>
        <Button type="submit" fullWidth loading={submitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
