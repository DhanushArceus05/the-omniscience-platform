import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@omniscience/ui";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const navItems = [
  { to: "/app", label: "Dashboard", icon: "🏠" },
  { to: "/app/settings", label: "Settings", icon: "⚙️" },
];

const breadcrumbs = [{ label: "Home", to: "/app" }, { label: "Dashboard" }];

/**
 * Installs a `window.matchMedia` stub so the AppShell's breakpoint hook
 * resolves to the desktop (`true`) or mobile/tablet (`false`) branch,
 * mirroring how a real browser evaluates `(min-width: 1025px)`.
 */
function stubViewport(isDesktop: boolean) {
  const mql = {
    matches: isDesktop,
    media: "(min-width: 1025px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue(mql),
  );
}

function renderShell() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <AppShell navItems={navItems} breadcrumbs={breadcrumbs} userName="Person Name" onSignOut={() => {}}>
          <p>page content</p>
        </AppShell>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("AppShell", () => {
  it("renders navigation items and breadcrumbs alongside the content", () => {
    stubViewport(false);
    renderShell();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getAllByText("Dashboard")).toHaveLength(2);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("page content")).toBeTruthy();
  });

  it("does not apply contained mode by default", () => {
    stubViewport(true);
    const { container } = renderShell();
    expect(container.querySelector(".omni-app-shell--contained")).toBeNull();
  });

  it("applies the contained/fill-viewport classes when `contained` is set", () => {
    stubViewport(true);
    const { container } = render(
      <ThemeProvider>
        <MemoryRouter>
          <AppShell navItems={navItems} breadcrumbs={breadcrumbs} userName="Person Name" onSignOut={() => {}} contained>
            <p>page content</p>
          </AppShell>
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(container.querySelector(".omni-app-shell--contained")).toBeTruthy();
    expect(container.querySelector(".omni-app-shell__main--contained")).toBeTruthy();
  });

  describe("mobile/tablet (<=1024px)", () => {
    it("starts with the drawer closed and opens/closes it via the hamburger button", () => {
      stubViewport(false);
      renderShell();

      const button = screen.getByLabelText("Expand navigation");
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByLabelText("Close navigation")).toBeNull();

      fireEvent.click(button);
      expect(screen.getByLabelText("Collapse navigation").getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByLabelText("Close navigation")).toBeTruthy();

      fireEvent.click(screen.getByLabelText("Collapse navigation"));
      expect(screen.getByLabelText("Expand navigation").getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByLabelText("Close navigation")).toBeNull();
    });

    it("closes the drawer when the scrim is clicked", () => {
      stubViewport(false);
      renderShell();
      fireEvent.click(screen.getByLabelText("Expand navigation"));
      fireEvent.click(screen.getByLabelText("Close navigation"));
      expect(screen.queryByLabelText("Close navigation")).toBeNull();
      expect(screen.getByLabelText("Expand navigation")).toBeTruthy();
    });

    it("closes the drawer when a sidebar item is clicked", () => {
      stubViewport(false);
      renderShell();
      fireEvent.click(screen.getByLabelText("Expand navigation"));
      expect(screen.getByLabelText("Close navigation")).toBeTruthy();

      fireEvent.click(screen.getByRole("link", { name: "Settings" }));
      expect(screen.queryByLabelText("Close navigation")).toBeNull();
      expect(screen.getByLabelText("Expand navigation")).toBeTruthy();
    });

    it("closes on Escape, regardless of which element inside the drawer has focus", () => {
      stubViewport(false);
      renderShell();
      fireEvent.click(screen.getByLabelText("Expand navigation"));
      expect(screen.getByLabelText("Close navigation")).toBeTruthy();

      // Focus is somewhere else entirely (document.body) — a listener
      // scoped only to the drawer's own onKeyDown would miss this.
      (document.body as HTMLElement).focus?.();
      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.queryByLabelText("Close navigation")).toBeNull();
      expect(screen.getByLabelText("Expand navigation")).toBeTruthy();
    });

    it("locks body scroll while open and restores it on close", () => {
      stubViewport(false);
      renderShell();
      const originalOverflow = document.body.style.overflow;

      fireEvent.click(screen.getByLabelText("Expand navigation"));
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.click(screen.getByLabelText("Close navigation"));
      expect(document.body.style.overflow).toBe(originalOverflow);
    });

    it("returns focus to the hamburger trigger when the drawer closes", () => {
      stubViewport(false);
      renderShell();
      const trigger = screen.getByLabelText("Expand navigation");
      fireEvent.click(trigger);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(document.activeElement).toBe(screen.getByLabelText("Expand navigation"));
    });
  });

  describe("desktop (>1024px)", () => {
    it("starts open by default", () => {
      stubViewport(true);
      renderShell();
      const button = screen.getByLabelText("Collapse navigation");
      expect(button.getAttribute("aria-expanded")).toBe("true");
      // The mobile scrim never renders on desktop, regardless of state.
      expect(screen.queryByLabelText("Close navigation")).toBeNull();
    });

    it("collapses on the first click and expands again on the second — the hamburger always stays usable", () => {
      stubViewport(true);
      renderShell();

      fireEvent.click(screen.getByLabelText("Collapse navigation"));
      const collapsedButton = screen.getByLabelText("Expand navigation");
      expect(collapsedButton.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(collapsedButton);
      const expandedButton = screen.getByLabelText("Collapse navigation");
      expect(expandedButton.getAttribute("aria-expanded")).toBe("true");

      fireEvent.click(expandedButton);
      expect(screen.getByLabelText("Expand navigation").getAttribute("aria-expanded")).toBe("false");
    });

    it("does not close the sidebar when a nav item is clicked", () => {
      stubViewport(true);
      renderShell();
      fireEvent.click(screen.getByRole("link", { name: "Settings" }));
      expect(screen.getByLabelText("Collapse navigation").getAttribute("aria-expanded")).toBe("true");
    });
  });
});
