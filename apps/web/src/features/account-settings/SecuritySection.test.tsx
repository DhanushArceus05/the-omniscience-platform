import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, OmniscienceClient } from "@omniscience/sdk";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { SecuritySection } from "./SecuritySection";

vi.mock("@omniscience/sdk", async () => {
  const actual = await vi.importActual<typeof import("@omniscience/sdk")>("@omniscience/sdk");
  return { ...actual, OmniscienceClient: vi.fn() };
});

const mockedClientCtor = vi.mocked(OmniscienceClient);

function mockClient(overrides: Record<string, ReturnType<typeof vi.fn>>) {
  mockedClientCtor.mockImplementation(() => overrides as unknown as OmniscienceClient);
}

const STORAGE_KEY = "omniscience.auth.session";
const USER = { id: "user-1", email: "person@example.com", name: "Person Name", avatarUrl: null };

function seedSession() {
  const session = {
    accessToken: "access-token",
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(Date.now() + 604_800_000).toISOString(),
    user: USER,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function renderSecurity() {
  return render(
    <AuthProvider>
      <SecuritySection />
    </AuthProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

const STRONG_PASSWORD = "N3wSup3r$ecretPassw0rd!";

describe("SecuritySection", () => {
  it("changes the password successfully and clears the fields", async () => {
    seedSession();
    const changePassword = vi.fn().mockResolvedValue({ email: "person@example.com" });
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), changePassword });
    renderSecurity();

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "OldPassw0rd!" },
    });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: STRONG_PASSWORD } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: STRONG_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(screen.getByText("Password changed")).toBeTruthy());
    expect(changePassword).toHaveBeenCalledWith("access-token", {
      currentPassword: "OldPassw0rd!",
      newPassword: STRONG_PASSWORD,
    });
    expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
  });

  it("shows a client-side error when the confirmation doesn't match, without calling the API", async () => {
    seedSession();
    const changePassword = vi.fn();
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), changePassword });
    renderSecurity();

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "OldPassw0rd!" },
    });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: STRONG_PASSWORD } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "Mismatched1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(screen.getByText("Passwords don't match.")).toBeTruthy());
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("shows a client-side validation error for a weak new password, without calling the API", async () => {
    seedSession();
    const changePassword = vi.fn();
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), changePassword });
    renderSecurity();

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "OldPassw0rd!" },
    });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "weak" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "weak" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(changePassword).not.toHaveBeenCalled());
  });

  it("shows CURRENT_PASSWORD_INCORRECT as a recoverable API error", async () => {
    seedSession();
    const changePassword = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ code: "CURRENT_PASSWORD_INCORRECT", message: "wrong", status: 400 }),
      );
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), changePassword });
    renderSecurity();

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "WrongPassw0rd!" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: STRONG_PASSWORD } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: STRONG_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(screen.getByText("The current password you entered is incorrect.")).toBeTruthy(),
    );
  });
});
