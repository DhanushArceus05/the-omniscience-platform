import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { Avatar } from "./Avatar";

afterEach(() => {
  cleanup();
});

describe("Badge", () => {
  it("renders children with the requested tone class", () => {
    render(<Badge tone="success">Active</Badge>);
    expect(screen.getByText("Active").className).toContain("omni-badge--success");
  });

  it("defaults to the neutral tone", () => {
    render(<Badge>Draft</Badge>);
    expect(screen.getByText("Draft").className).toContain("omni-badge--neutral");
  });
});

describe("Avatar", () => {
  it("renders initials when no image is provided", () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByText("AL")).toBeTruthy();
  });

  it("falls back to initials if the image fails to load", () => {
    render(<Avatar name="Grace Hopper" src="https://example.com/broken.png" />);
    const img = screen.getByRole("img", { name: "Grace Hopper" }).querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(screen.getByText("GH")).toBeTruthy();
  });

  it("handles a single-word name", () => {
    render(<Avatar name="Cher" />);
    expect(screen.getByText("CH")).toBeTruthy();
  });
});
