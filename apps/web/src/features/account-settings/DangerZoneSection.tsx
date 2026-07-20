import { useState, type FormEvent, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { deleteAccountRequestSchema } from "@omniscience/schemas";
import { Alert, Button, Card, Input } from "@omniscience/ui";
import { useAuth } from "../../lib/auth/AuthContext";
import { getFieldErrors, type FieldErrors } from "../../lib/auth/authErrors";
import { validateWithSchema } from "../../lib/auth/validateWithSchema";
import { getAccountSettingsErrorMessage } from "./accountSettingsErrors";

const CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";

/**
 * Danger Zone tab of the Settings experience (Phase 3 Step 3):
 * permanent, irreversible account deletion. Requires both the caller's
 * current password (the backend's own requirement — a bare stolen/
 * leaked access token alone must not be enough to destroy the account)
 * and, as a UI-only extra safeguard, typing the exact confirmation
 * phrase below. The typed phrase is never sent to the backend — it's
 * purely a "make sure you meant to do this" affordance layered on top
 * of the real request contract (`{ password }`).
 *
 * On success: clears the local session via `AuthContext.logout()` (the
 * account and all its sessions are already gone server-side by this
 * point, so this is just local cleanup) and redirects to `/login` — a
 * deleted account has nothing left to sign back into, but `/login` is
 * this app's stable public entry point either way.
 */
export function DangerZoneSection(): JSX.Element {
  const { client, accessToken, logout } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isConfirmationCorrect = confirmationText === CONFIRMATION_PHRASE;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (!isConfirmationCorrect) {
      setFormError(`Please type "${CONFIRMATION_PHRASE}" exactly to confirm.`);
      return;
    }

    const validation = validateWithSchema(deleteAccountRequestSchema, { password });
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      return;
    }

    if (!client || !accessToken) {
      setFormError("Account deletion is unavailable right now — the API isn't configured.");
      return;
    }

    setDeleting(true);
    try {
      await client.deleteAccount(accessToken, validation.data);
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setFieldErrors(getFieldErrors(error));
      setFormError(getAccountSettingsErrorMessage(error));
      setDeleting(false);
    }
  }

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Delete account</h3>
      <p>
        This permanently deletes your account, every workspace you own, and all of your active
        sessions. This cannot be undone.
      </p>
      <form
        onSubmit={(event) => void handleSubmit(event)}
        style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}
      >
        {formError && (
          <Alert tone="error" title="Couldn't delete your account">
            {formError}
          </Alert>
        )}
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={fieldErrors.password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Input
          label={`Type "${CONFIRMATION_PHRASE}" to confirm`}
          value={confirmationText}
          onChange={(event) => setConfirmationText(event.target.value)}
        />
        <Button
          type="submit"
          variant="danger"
          loading={deleting}
          disabled={!isConfirmationCorrect || password.length === 0}
          style={{ alignSelf: "flex-start" }}
        >
          Permanently delete my account
        </Button>
      </form>
    </Card>
  );
}
