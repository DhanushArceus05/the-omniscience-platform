import { useState, type FormEvent, type JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input, useToast } from "@omniscience/ui";
import { AuthLayout } from "./auth/AuthLayout";

export function RegisterPage(): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitting(true);
    // UI-only preview: no account is actually created in Phase 1.
    window.setTimeout(() => {
      setSubmitting(false);
      showToast({
        tone: "success",
        title: "Preview only",
        description: "Account creation arrives with authentication in Phase 2.",
      });
      navigate("/verify-otp");
    }, 600);
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
        <Input
          label="Full name"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
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
          autoComplete="new-password"
          required
          helperText="At least 8 characters."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" fullWidth loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
