import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OmniscienceClient } from "@omniscience/sdk";
import { AuthProvider } from "../../lib/auth/AuthContext";
import { SettingsExperience } from "./SettingsExperience";

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

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsExperience", () => {
  it("starts on the Profile tab and does not fetch sessions until that tab is opened", async () => {
    seedSession();
    const listSessions = vi.fn().mockResolvedValue([]);
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), listSessions });
    render(
      <MemoryRouter>
        <AuthProvider>
          <SettingsExperience />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(listSessions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));

    await waitFor(() => expect(listSessions).toHaveBeenCalledWith("access-token"));
  });

  it("navigates between every tab: Profile, Security, Sessions, Danger Zone", async () => {
    seedSession();
    mockClient({ getMe: vi.fn().mockResolvedValue(USER), listSessions: vi.fn().mockResolvedValue([]) });
    render(
      <MemoryRouter>
        <AuthProvider>
          <SettingsExperience />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    expect(screen.getByRole("button", { name: "Update password" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Danger Zone" }));
    expect(screen.getByRole("button", { name: "Permanently delete my account" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    expect(screen.getByLabelText("Display name")).toBeTruthy();
  });
});
