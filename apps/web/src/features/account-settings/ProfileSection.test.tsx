import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, OmniscienceClient } from "@omniscience/sdk";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { ProfileSection } from "./ProfileSection";

vi.mock("@omniscience/sdk", async () => {
  const actual = await vi.importActual<typeof import("@omniscience/sdk")>("@omniscience/sdk");
  return { ...actual, OmniscienceClient: vi.fn() };
});

const mockedClientCtor = vi.mocked(OmniscienceClient);

function mockClient(overrides: Record<string, ReturnType<typeof vi.fn>>) {
  mockedClientCtor.mockImplementation(() => overrides as unknown as OmniscienceClient);
}

const STORAGE_KEY = "omniscience.auth.session";
const USER = { id: "user-1", email: "person@example.com", name: "Person Name", avatarUrl: null as string | null };

function seedSession(user: typeof USER = USER) {
  const session = {
    accessToken: "access-token",
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(Date.now() + 604_800_000).toISOString(),
    user,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function renderProfile() {
  return render(
    <AuthProvider>
      <ProfileSection />
    </AuthProvider>,
  );
}

function makeFile(name: string, type: string, content = "fake-image-bytes"): File {
  return new File([content], name, { type });
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("ProfileSection", () => {
  it("shows initials as the avatar fallback when there is no avatarUrl", () => {
    seedSession({ ...USER, avatarUrl: null });
    mockClient({ getMe: vi.fn().mockResolvedValue(USER) });
    renderProfile();

    const avatars = screen.getAllByRole("img", { name: "Person Name" });
    expect(avatars[0]?.querySelector("img")).toBeNull();
    expect(avatars[0]?.textContent).toBe("PN");
  });

  it("shows the avatar image when avatarUrl is set", () => {
    seedSession({ ...USER, avatarUrl: "http://localhost:4000/uploads/avatars/existing.jpg" });
    mockClient({ getMe: vi.fn().mockResolvedValue(USER) });
    renderProfile();

    const avatars = screen.getAllByRole("img", { name: "Person Name" });
    const img = avatars[0]?.querySelector("img");
    expect(img?.getAttribute("src")).toBe("http://localhost:4000/uploads/avatars/existing.jpg");
    expect(screen.getByRole("button", { name: "Replace photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeTruthy();
  });

  it("does not show a Remove photo button when there is no avatar", () => {
    seedSession({ ...USER, avatarUrl: null });
    mockClient({ getMe: vi.fn().mockResolvedValue(USER) });
    renderProfile();

    expect(screen.getByRole("button", { name: "Upload photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
  });

  it("uploads a new avatar and updates the display immediately, with no page reload", async () => {
    seedSession({ ...USER, avatarUrl: null });
    const uploadAvatar = vi
      .fn()
      .mockResolvedValue({ avatarUrl: "http://localhost:4000/uploads/avatars/new.jpg" });
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), uploadAvatar });
    renderProfile();

    const input = screen.getByLabelText("Upload avatar") as HTMLInputElement;
    const file = makeFile("photo.jpg", "image/jpeg");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole("button", { name: "Remove photo" })).toBeTruthy());
    expect(uploadAvatar).toHaveBeenCalledWith("access-token", file);
    const avatars = screen.getAllByRole("img", { name: "Person Name" });
    expect(avatars[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "http://localhost:4000/uploads/avatars/new.jpg",
    );
  });

  it("rejects an unsupported file type client-side without calling the API", async () => {
    seedSession({ ...USER, avatarUrl: null });
    const uploadAvatar = vi.fn();
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), uploadAvatar });
    renderProfile();

    const input = screen.getByLabelText("Upload avatar") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile("photo.gif", "image/gif")] } });

    await waitFor(() =>
      expect(screen.getByText("Please upload a JPEG, PNG, or WebP image.")).toBeTruthy(),
    );
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it("rejects an oversized file client-side without calling the API", async () => {
    seedSession({ ...USER, avatarUrl: null });
    const uploadAvatar = vi.fn();
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), uploadAvatar });
    renderProfile();

    const input = screen.getByLabelText("Upload avatar") as HTMLInputElement;
    const bigFile = makeFile("huge.jpg", "image/jpeg", "x".repeat(6 * 1024 * 1024));
    fireEvent.change(input, { target: { files: [bigFile] } });

    await waitFor(() =>
      expect(
        screen.getByText("That image is too large. Please choose a smaller file (5MB or less)."),
      ).toBeTruthy(),
    );
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it("shows a recoverable error when the upload API call fails", async () => {
    seedSession({ ...USER, avatarUrl: null });
    const uploadAvatar = vi
      .fn()
      .mockRejectedValue(new ApiClientError({ code: "AVATAR_TYPE_UNSUPPORTED", message: "nope", status: 415 }));
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), uploadAvatar });
    renderProfile();

    const input = screen.getByLabelText("Upload avatar") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile("photo.jpg", "image/jpeg")] } });

    await waitFor(() =>
      expect(screen.getByText("Please upload a JPEG, PNG, or WebP image.")).toBeTruthy(),
    );
  });

  it("removes an existing avatar and falls back to initials immediately", async () => {
    seedSession({ ...USER, avatarUrl: "http://localhost:4000/uploads/avatars/existing.jpg" });
    const deleteAvatar = vi.fn().mockResolvedValue({ avatarUrl: null });
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), deleteAvatar });
    renderProfile();

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    await waitFor(() => expect(deleteAvatar).toHaveBeenCalledWith("access-token"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull());
    const avatars = screen.getAllByRole("img", { name: "Person Name" });
    expect(avatars[0]?.querySelector("img")).toBeNull();
    expect(avatars[0]?.textContent).toBe("PN");
  });

  it("updates the display name and saves it", async () => {
    seedSession();
    const updateProfile = vi.fn().mockResolvedValue({
      id: "user-1",
      email: "person@example.com",
      name: "New Name",
      avatarUrl: null,
    });
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), updateProfile });
    renderProfile();

    const nameInput = screen.getByLabelText("Display name");
    fireEvent.change(nameInput, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("Your display name has been updated.")).toBeTruthy());
    expect(updateProfile).toHaveBeenCalledWith("access-token", { name: "New Name" });
  });

  it("shows a client-side validation error for a too-short name and never calls the API", async () => {
    seedSession();
    const updateProfile = vi.fn();
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), updateProfile });
    renderProfile();

    const nameInput = screen.getByLabelText("Display name");
    fireEvent.change(nameInput, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("Name must be at least 2 characters")).toBeTruthy());
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("shows the email as read-only", () => {
    seedSession();
    mockClient({ getMe: vi.fn().mockResolvedValue(USER) });
    renderProfile();

    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    expect(emailInput.readOnly).toBe(true);
    expect(emailInput.value).toBe("person@example.com");
  });
});
