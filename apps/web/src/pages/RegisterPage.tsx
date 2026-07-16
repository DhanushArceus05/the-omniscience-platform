import { useState, type FormEvent, type JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerRequestSchema } from "@omniscience/schemas";
import { Alert, Button, Input, useToast } from "@omniscience/ui";
import { useAuth } from "../lib/auth/AuthContext";
import { getAuthErrorMessage, getFieldErrors, type FieldErrors } from "../lib/auth/authErrors";
import { validateWithSchema } from "../lib/auth/validateWithSchema";
import { AuthLayout } from "./auth/AuthLayout";

export function RegisterPage(): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { client } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const validation = validateWithSchema(registerRequestSchema, { name, email, password });
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    setFieldErrors({});

    if (!client) {
      setFormError("Registration is unavailable right now — the API isn't configured.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await client.register(validation.data);
      showToast({
        tone: "success",
        title: "Verification code sent",
        description: `Check ${result.email} for your 6-digit code.`,
      });
      navigate("/verify-otp", { state: { email: result.email } });
    } catch (error) {
      setFieldErrors(getFieldErrors(error));
      setFormError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start exploring the Omniscience Platform shell."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}>
        {formError && (
          <Alert tone="error" title="Couldn't create your account">
            {formError}
          </Alert>
        )}
        <Input
          label="Full name"
          autoComplete="name"
          required
          value={name}
          error={fieldErrors.name}
          onChange={(event) => setName(event.target.value)}
        />
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
          autoComplete="new-password"
          required
          helperText="At least 10 characters, with upper/lowercase, a number, and a symbol."
          value={password}
          error={fieldErrors.password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" fullWidth loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
