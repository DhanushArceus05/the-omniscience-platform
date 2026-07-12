import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";

afterEach(() => {
  cleanup();
});

describe("EmptyState", () => {
  it("renders title, description and action", () => {
    render(
      <EmptyState
        title="No projects yet"
        description="Create your first project to get started."
        action={<button>New project</button>}
      />,
    );
    expect(screen.getByText("No projects yet")).toBeTruthy();
    expect(screen.getByText("Create your first project to get started.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New project" })).toBeTruthy();
  });
});

describe("ErrorState", () => {
  it("renders default copy and an alert role", () => {
    render(<ErrorState />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  it("renders custom copy when provided", () => {
    render(<ErrorState title="Failed to load resume" description="Check your connection." />);
    expect(screen.getByText("Failed to load resume")).toBeTruthy();
    expect(screen.getByText("Check your connection.")).toBeTruthy();
  });
});
