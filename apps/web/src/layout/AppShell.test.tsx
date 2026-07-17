import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@omniscience/ui";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
});

const navItems = [
  { to: "/app", label: "Dashboard", icon: "🏠" },
  { to: "/app/settings", label: "Settings", icon: "⚙️" },
];

const breadcrumbs = [{ label: "Home", to: "/app" }, { label: "Dashboard" }];

describe("AppShell", () => {
  it("renders navigation items and breadcrumbs alongside the content", () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <AppShell navItems={navItems} breadcrumbs={breadcrumbs} userName="Person Name" onSignOut={() => {}}>
            <p>page content</p>
          </AppShell>
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getAllByText("Dashboard")).toHaveLength(2);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("page content")).toBeTruthy();
  });

  it("toggles the mobile sidebar scrim when the menu button is clicked", () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <AppShell navItems={navItems} breadcrumbs={breadcrumbs} userName="Person Name" onSignOut={() => {}}>
            <p>page content</p>
          </AppShell>
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.queryByLabelText("Close navigation")).toBeNull();
    fireEvent.click(screen.getByLabelText("Toggle navigation"));
    expect(screen.getByLabelText("Close navigation")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close navigation"));
    expect(screen.queryByLabelText("Close navigation")).toBeNull();
  });
});
