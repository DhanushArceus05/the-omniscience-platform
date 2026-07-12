import { useState, type FormEvent, type JSX } from "react";
import { Link } from "react-router-dom";
import { Button, Input, useToast } from "@omniscience/ui";
import { AuthLayout } from "./auth/AuthLayout";

export function ResetPasswordPage(): JSX.Element {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (mismatch) return;
    setSubmitting(true);
    // UI-only preview: no password is actually changed in Phase 1.
    window.setTimeout(() => {
      setSubmitting(false);
      showToast({
        tone: "success",
        title: "Preview only",
        description: "Password reset arrives in Phase 2.",
      });
    }, 600);
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Make it something you haven't used before."
      footer={
        <>
          <Link to="/login">Back to sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}>
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
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
