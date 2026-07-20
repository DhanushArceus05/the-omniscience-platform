import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, OmniscienceClient } from "@omniscience/sdk";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { DangerZoneSection } from "./DangerZoneSection";

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

function renderDangerZone() {
  return render(
    <MemoryRouter initialEntries={["/app/settings"]}>
      <AuthProvider>
        <Routes>
          <Route path="/app/settings" element={<DangerZoneSection />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("DangerZoneSection", () => {
  it("keeps the delete button disabled until the confirmation phrase is typed exactly", async () => {
    seedSession();
    mockClient({ getMe: vi.fn().mockResolvedValue(USER) });
    renderDangerZone();

    const deleteButton = screen.getByRole("button", {
      name: "Permanently delete my account",
    }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "CorrectPassw0rd!" },
    });
    fireEvent.change(screen.getByLabelText('Type "DELETE MY ACCOUNT" to confirm'), {
      target: { value: "delete my account" },
    });
    expect(deleteButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Type "DELETE MY ACCOUNT" to confirm'), {
      target: { value: "DELETE MY ACCOUNT" },
    });
    expect(deleteButton.disabled).toBe(false);
  });

  it("deletes the account, clears the local session, and redirects to /login", async () => {
    seedSession();
    const deleteAccount = vi.fn().mockResolvedValue({ deleted: true });
    const logout = vi.fn().mockResolvedValue(undefined);
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), deleteAccount, logout });
    renderDangerZone();

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "CorrectPassw0rd!" },
    });
    fireEvent.change(screen.getByLabelText('Type "DELETE MY ACCOUNT" to confirm'), {
      target: { value: "DELETE MY ACCOUNT" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Permanently delete my account" }));

    await waitFor(() => expect(screen.getByText("Login page")).toBeTruthy());
    expect(deleteAccount).toHaveBeenCalledWith("access-token", { password: "CorrectPassw0rd!" });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("shows a recoverable error and stays on the page when deletion fails", async () => {
    seedSession();
    const deleteAccount = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ code: "CURRENT_PASSWORD_INCORRECT", message: "wrong", status: 400 }),
      );
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), deleteAccount });
    renderDangerZone();

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "WrongPassword!" },
    });
    fireEvent.change(screen.getByLabelText('Type "DELETE MY ACCOUNT" to confirm'), {
      target: { value: "DELETE MY ACCOUNT" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Permanently delete my account" }));

    await waitFor(() =>
      expect(screen.getByText("The current password you entered is incorrect.")).toBeTruthy(),
    );
    expect(screen.queryByText("Login page")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});
