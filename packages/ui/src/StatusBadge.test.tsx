import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

afterEach(() => {
  cleanup();
});

describe("StatusBadge", () => {
  it("renders the provided label", () => {
    render(<StatusBadge tone="ok" label="API: ok" />);
    expect(screen.getByText("API: ok")).toBeTruthy();
  });

  it("exposes the tone via a data attribute for styling/tests", () => {
    render(<StatusBadge tone="down" label="AI Service: down" />);
    const badge = screen.getByTestId("status-badge");
    expect(badge.getAttribute("data-tone")).toBe("down");
  });

  it.each([["ok"], ["degraded"], ["down"]] as const)(
    "renders without throwing for tone=%s",
    (tone) => {
      expect(() => render(<StatusBadge tone={tone} label={tone} />)).not.toThrow();
    },
  );
});
