import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "./Card";
import { GlassCard } from "./GlassCard";

afterEach(() => {
  cleanup();
});

describe("Card", () => {
  it("renders children with the base card class", () => {
    render(<Card>content</Card>);
    expect(screen.getByText("content").className).toContain("omni-card");
  });
});

describe("GlassCard", () => {
  it("renders children with the glass card class", () => {
    render(<GlassCard>glass content</GlassCard>);
    expect(screen.getByText("glass content").className).toContain("omni-glass-card");
  });

  it("adds the interactive class when requested", () => {
    render(<GlassCard interactive>clickable</GlassCard>);
    expect(screen.getByText("clickable").className).toContain("omni-glass-card--interactive");
  });
});
