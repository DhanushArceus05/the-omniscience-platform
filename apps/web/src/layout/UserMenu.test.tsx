import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@omniscience/ui";
import { UserMenu } from "./UserMenu";

afterEach(() => {
  cleanup();
});

describe("UserMenu", () => {
  it("calls onSignOut when Sign out is selected", () => {
    const onSignOut = vi.fn();
    render(
      <ThemeProvider>
        <UserMenu name="Person Name" onSignOut={onSignOut} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("img", { name: "Person Name" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("still shows Profile and Settings as disabled/coming soon", () => {
    render(
      <ThemeProvider>
        <UserMenu name="Person Name" onSignOut={() => {}} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("img", { name: "Person Name" }));

    expect(screen.getByRole("menuitem", { name: "Profile (coming soon)" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("menuitem", { name: "Settings (coming soon)" })).toHaveProperty("disabled", true);
  });
});
