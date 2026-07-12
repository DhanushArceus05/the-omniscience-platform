import { useState, type FormEvent, type JSX } from "react";
import { Link } from "react-router-dom";
import { Button, Input, useToast } from "@omniscience/ui";
import { AuthLayout } from "./auth/AuthLayout";

export function LoginPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitting(true);
    // UI-only preview: no backend/auth call happens in Phase 1.
    window.setTimeout(() => {
      setSubmitting(false);
      showToast({
        tone: "info",
        title: "Preview only",
        description: "Sign-in wiring arrives with authentication in Phase 2.",
      });
    }, 600);
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
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
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
