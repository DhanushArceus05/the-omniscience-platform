import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar, type SidebarNavItem } from "./Sidebar";

afterEach(() => {
  cleanup();
});

const items: SidebarNavItem[] = [
  { to: "/app", label: "Overview", icon: "🏠" },
  { to: "/app/workspace", label: "Workspace", icon: "🗂️" },
  { to: "/app/settings", label: "Settings", icon: "⚙️" },
];

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar items={items} open={false} />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("marks only Overview active at /app, not Workspace or Settings", () => {
    renderAt("/app");
    expect(screen.getByRole("link", { name: /Overview/ }).className).toContain("--active");
    expect(screen.getByRole("link", { name: /Workspace/ }).className).not.toContain("--active");
    expect(screen.getByRole("link", { name: /Settings/ }).className).not.toContain("--active");
  });

  it("marks only Settings active at /app/settings — Overview must not also appear active", () => {
    renderAt("/app/settings");
    expect(screen.getByRole("link", { name: /Settings/ }).className).toContain("--active");
    expect(screen.getByRole("link", { name: /Overview/ }).className).not.toContain("--active");
    expect(screen.getByRole("link", { name: /Workspace/ }).className).not.toContain("--active");
  });

  it("never has more than one active item at once, for every /app/* route", () => {
    for (const pathname of ["/app", "/app/workspace", "/app/settings"]) {
      cleanup();
      renderAt(pathname);
      const activeCount = items.filter((item) =>
        screen.getByRole("link", { name: new RegExp(item.label) }).className.includes("--active"),
      ).length;
      expect(activeCount).toBe(1);
    }
  });
});
