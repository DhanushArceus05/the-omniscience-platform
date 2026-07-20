import { useState, type FormEvent, type JSX } from "react";
import { changePasswordRequestSchema } from "@omniscience/schemas";
import { Alert, Button, Card, Input } from "@omniscience/ui";
import { useAuth } from "../../lib/auth/AuthContext";
import { getFieldErrors, type FieldErrors } from "../../lib/auth/authErrors";
import { validateWithSchema } from "../../lib/auth/validateWithSchema";
import { getAccountSettingsErrorMessage } from "./accountSettingsErrors";

/**
 * Security tab of the Settings experience (Phase 3 Step 3): change
 * password while already signed in (distinct from the unauthenticated,
 * OTP-gated forgot-password flow). `confirmNewPassword` is a
 * client-side-only safeguard against typos — it's never sent to the
 * backend, which only ever sees `currentPassword`/`newPassword`.
 */
export function SecuritySection(): JSX.Element {
  const { client, accessToken } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirmError, setConfirmError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSuccess(false);
    setFormError(null);
    setConfirmError(undefined);
    setFieldErrors({});

    if (newPassword !== confirmNewPassword) {
      setConfirmError("Passwords don't match.");
      return;
    }

    const validation = validateWithSchema(changePasswordRequestSchema, {
      currentPassword,
      newPassword,
    });
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      return;
    }

    if (!client || !accessToken) {
      setFormError("Password changes are unavailable right now — the API isn't configured.");
      return;
    }

    setSaving(true);
    try {
      await client.changePassword(accessToken, validation.data);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (error) {
      setFieldErrors(getFieldErrors(error));
      setFormError(getAccountSettingsErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Change password</h3>
      <form
        onSubmit={(event) => void handleSubmit(event)}
        style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}
      >
        {success && (
          <Alert tone="success" title="Password changed">
            Your password has been updated.
          </Alert>
        )}
        {formError && (
          <Alert tone="error" title="Couldn't change your password">
            {formError}
          </Alert>
        )}
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          error={fieldErrors.currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          error={fieldErrors.newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmNewPassword}
          error={confirmError}
          onChange={(event) => setConfirmNewPassword(event.target.value)}
        />
        <Button type="submit" loading={saving} style={{ alignSelf: "flex-start" }}>
          Update password
        </Button>
      </form>
    </Card>
  );
}
