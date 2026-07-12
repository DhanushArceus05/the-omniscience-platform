import { useState, type JSX } from "react";
import { Link } from "react-router-dom";
import { Button, OtpInput, useToast } from "@omniscience/ui";
import { AuthLayout } from "./auth/AuthLayout";

export function VerifyOtpPage(): JSX.Element {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  function handleVerify(): void {
    setSubmitting(true);
    // UI-only preview: no OTP is actually sent or checked in Phase 1.
    window.setTimeout(() => {
      setSubmitting(false);
      showToast({
        tone: "info",
        title: "Preview only",
        description: "OTP delivery and verification arrive in Phase 2.",
      });
    }, 600);
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle="Enter the 6-digit code we've sent to your inbox."
      footer={
        <>
          Didn&apos;t get a code? <Link to="/register">Resend</Link>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-6)" }}>
        <OtpInput value={code} onChange={setCode} onComplete={handleVerify} />
        <Button fullWidth loading={submitting} disabled={code.length < 6} onClick={handleVerify}>
          Verify
        </Button>
      </div>
    </AuthLayout>
  );
}
