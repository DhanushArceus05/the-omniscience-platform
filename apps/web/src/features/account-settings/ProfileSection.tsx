import { useRef, useState, type ChangeEvent, type FormEvent, type JSX } from "react";
import { updateProfileRequestSchema } from "@omniscience/schemas";
import { Alert, Avatar, Button, Card, Input } from "@omniscience/ui";
import { useAuth } from "../../lib/auth/AuthContext";
import { getFieldErrors, type FieldErrors } from "../../lib/auth/authErrors";
import { validateWithSchema } from "../../lib/auth/validateWithSchema";
import { getAccountSettingsErrorMessage } from "./accountSettingsErrors";

/**
 * Mirrors `AvatarStorageService`'s own rules
 * (`apps/api/src/avatar/avatar-storage.service.ts`) purely for
 * immediate client-side feedback — the backend re-validates (size,
 * declared MIME type, *and* the file's actual magic bytes) regardless,
 * and remains the sole source of truth. A file that passes this check
 * can still be rejected server-side (e.g. a renamed non-image file);
 * that rejection surfaces through the normal API-error path below.
 */
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

type AvatarState = { status: "idle" } | { status: "uploading" } | { status: "error"; message: string };

/**
 * Profile tab of the Settings experience (Phase 3 Step 3): avatar
 * preview + upload/replace/remove, display-name update, and a
 * read-only email field (changing the address a verified account is
 * tied to remains out of scope — see `packages/schemas/src/users.ts`'s
 * docstring on `updateProfileRequestSchema`).
 *
 * Every successful change calls `AuthContext.updateUser` so the
 * TopBar/UserMenu avatar and name update immediately, with no reload.
 */
export function ProfileSection(): JSX.Element {
  const { client, accessToken, user, updateUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user?.name ?? "");
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [savingName, setSavingName] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);

  const [avatarState, setAvatarState] = useState<AvatarState>({ status: "idle" });
  const [removingAvatar, setRemovingAvatar] = useState(false);

  function handleChooseFile(): void {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Always reset so choosing the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      setAvatarState({ status: "error", message: "Please upload a JPEG, PNG, or WebP image." });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarState({
        status: "error",
        message: "That image is too large. Please choose a smaller file (5MB or less).",
      });
      return;
    }

    if (!client || !accessToken) {
      setAvatarState({
        status: "error",
        message: "Avatars are unavailable right now — the API isn't configured.",
      });
      return;
    }

    setAvatarState({ status: "uploading" });
    try {
      const result = await client.uploadAvatar(accessToken, file);
      updateUser({ avatarUrl: result.avatarUrl });
      setAvatarState({ status: "idle" });
    } catch (error) {
      setAvatarState({ status: "error", message: getAccountSettingsErrorMessage(error) });
    }
  }

  async function handleRemoveAvatar(): Promise<void> {
    if (!client || !accessToken) {
      setAvatarState({
        status: "error",
        message: "Avatars are unavailable right now — the API isn't configured.",
      });
      return;
    }
    setRemovingAvatar(true);
    try {
      const result = await client.deleteAvatar(accessToken);
      updateUser({ avatarUrl: result.avatarUrl });
      setAvatarState({ status: "idle" });
    } catch (error) {
      setAvatarState({ status: "error", message: getAccountSettingsErrorMessage(error) });
    } finally {
      setRemovingAvatar(false);
    }
  }

  async function handleNameSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNameSuccess(false);
    setNameError(undefined);

    const validation = validateWithSchema(updateProfileRequestSchema, { name });
    if (!validation.valid) {
      setNameError(validation.fieldErrors.name);
      return;
    }

    if (!client || !accessToken) {
      setNameError("Profile updates are unavailable right now — the API isn't configured.");
      return;
    }

    setSavingName(true);
    try {
      const result = await client.updateProfile(accessToken, validation.data);
      updateUser({ name: result.name, avatarUrl: result.avatarUrl });
      setNameSuccess(true);
    } catch (error) {
      const fieldErrors: FieldErrors = getFieldErrors(error);
      setNameError(fieldErrors.name ?? getAccountSettingsErrorMessage(error));
    } finally {
      setSavingName(false);
    }
  }

  const isUploading = avatarState.status === "uploading";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-6)" }}>
      <Card>
        <h3 style={{ marginTop: 0 }}>Profile photo</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--omni-space-4)", flexWrap: "wrap" }}>
          <Avatar name={user?.name ?? "?"} src={user?.avatarUrl ?? undefined} size="lg" />
          <div style={{ display: "flex", gap: "var(--omni-space-3)", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={handleChooseFile} loading={isUploading} disabled={removingAvatar}>
              {user?.avatarUrl ? "Replace photo" : "Upload photo"}
            </Button>
            {user?.avatarUrl && (
              <Button
                variant="ghost"
                onClick={() => void handleRemoveAvatar()}
                loading={removingAvatar}
                disabled={isUploading}
              >
                Remove photo
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Upload avatar"
              onChange={(event) => void handleFileSelected(event)}
              style={{ display: "none" }}
            />
          </div>
        </div>
        {avatarState.status === "error" && (
          <div style={{ marginTop: "var(--omni-space-4)" }}>
            <Alert tone="error" title="Couldn't update your photo">
              {avatarState.message}
            </Alert>
          </div>
        )}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>Display details</h3>
        <form
          onSubmit={(event) => void handleNameSubmit(event)}
          style={{ display: "flex", flexDirection: "column", gap: "var(--omni-space-4)" }}
        >
          {nameSuccess && (
            <Alert tone="success" title="Saved">
              Your display name has been updated.
            </Alert>
          )}
          <Input
            label="Display name"
            value={name}
            error={nameError}
            onChange={(event) => {
              setName(event.target.value);
              setNameSuccess(false);
            }}
          />
          <Input label="Email" value={user?.email ?? ""} disabled readOnly helperText="Your email can't be changed here." />
          <Button type="submit" loading={savingName} style={{ alignSelf: "flex-start" }}>
            Save changes
          </Button>
        </form>
      </Card>
    </div>
  );
}
