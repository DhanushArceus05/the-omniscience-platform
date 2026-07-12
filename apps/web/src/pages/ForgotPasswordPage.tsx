import { useState, type FormEvent, type JSX } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Input, useToast } from "@omniscience/ui";
import { AuthLayout } from "./auth/AuthLayout";

export function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const { showToast } = useToast();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitting(true);
    // UI-only preview: no reset email is actually sent in Phase 1.
    window.setTimeout(() => {
      setSubmitting(false);
      setSent(true);
      showToast({
        tone: "info",
        title: "Preview only",
        description: "Password-reset delivery arrives in Phase 2.",
      });
    }, 600);
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="We'll send a reset link to your email."
      footer={
        <>
          Remembered it? <Link to="/login">Back to sign in</Link>
        </>
      }
    >
      {sent ? (
        <Alert tone="success" title="Check your inbox">
          If an account exists for that email, a reset link is on its way.
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button type="submit" fullWidth loading={submitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
