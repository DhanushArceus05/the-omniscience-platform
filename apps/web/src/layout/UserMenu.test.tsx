import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@omniscience/ui";
import { UserMenu } from "./UserMenu";

afterEach(() => {
  cleanup();
});

function renderMenu(props: Partial<Parameters<typeof UserMenu>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <ThemeProvider>
        <Routes>
          <Route
            path="/app"
            element={<UserMenu name="Person Name" onSignOut={props.onSignOut ?? vi.fn()} {...props} />}
          />
          <Route path="/app/settings" element={<div>Settings page</div>} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("UserMenu", () => {
  it("shows the display name next to the avatar", () => {
    renderMenu();
    expect(screen.getByText("Person Name")).toBeTruthy();
  });

  it("calls onSignOut when Logout is selected", () => {
    const onSignOut = vi.fn();
    renderMenu({ onSignOut });

    fireEvent.click(screen.getByRole("img", { name: "Person Name" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Logout" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("navigates to /app/settings — a real, working link, not a disabled placeholder", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("img", { name: "Person Name" }));
    expect(screen.queryByText("Profile (coming soon)")).toBeNull();
    expect(screen.queryByText("Settings (coming soon)")).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));

    expect(screen.getByText("Settings page")).toBeTruthy();
  });

  it("navigates to /app/settings when Profile is selected", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("img", { name: "Person Name" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Profile" }));

    expect(screen.getByText("Settings page")).toBeTruthy();
  });

  it("shows the display name and email in the dropdown's identity header", () => {
    renderMenu({ email: "person@example.com" });

    const trigger = screen.getAllByText("Person Name")[0];
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger as HTMLElement);
    expect(screen.getByText("person@example.com")).toBeTruthy();
    // Two "Person Name" occurrences: the trigger and the identity header.
    expect(screen.getAllByText("Person Name")).toHaveLength(2);
  });

  it("omits the email line when no email is provided", () => {
    renderMenu({ email: undefined });

    fireEvent.click(screen.getByRole("img", { name: "Person Name" }));
    expect(screen.queryByText("person@example.com")).toBeNull();
  });

  it("shows the user's avatar image when avatarUrl is set", () => {
    renderMenu({ avatarUrl: "http://localhost:4000/uploads/avatars/abc.jpg" });

    const image = screen.getByRole("img", { name: "Person Name" }).querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("http://localhost:4000/uploads/avatars/abc.jpg");
  });

  it("falls back to initials when avatarUrl is null", () => {
    renderMenu({ avatarUrl: null });

    const trigger = screen.getByRole("img", { name: "Person Name" });
    expect(trigger.querySelector("img")).toBeNull();
    expect(trigger.textContent).toBe("PN");
  });
});
