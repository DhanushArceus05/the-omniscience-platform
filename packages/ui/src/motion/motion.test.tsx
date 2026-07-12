import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FadeIn, SlideIn, ScaleIn } from "./Reveal";
import { Floating } from "./Floating";
import { Magnetic } from "./Magnetic";
import { RippleSurface } from "./RippleSurface";
import { RouteTransition } from "./RouteTransition";

afterEach(() => {
  cleanup();
});

describe("Reveal wrappers", () => {
  it("FadeIn applies the fade animation class", () => {
    render(<FadeIn>content</FadeIn>);
    expect(screen.getByText("content").className).toContain("omni-motion-fade");
  });

  it("SlideIn applies a directional slide class", () => {
    render(<SlideIn direction="left">content</SlideIn>);
    expect(screen.getByText("content").className).toContain("omni-motion-slide-left");
  });

  it("ScaleIn applies the scale animation class", () => {
    render(<ScaleIn>content</ScaleIn>);
    expect(screen.getByText("content").className).toContain("omni-motion-scale");
  });
});

describe("Floating", () => {
  it("renders children with the float class", () => {
    render(<Floating>orb</Floating>);
    expect(screen.getByText("orb").className).toContain("omni-motion-float");
  });
});

describe("Magnetic", () => {
  it("renders children and resets transform on mouse leave", () => {
    render(
      <Magnetic>
        <button>press</button>
      </Magnetic>,
    );
    const button = screen.getByText("press");
    const wrapper = button.parentElement as HTMLElement;
    expect(wrapper.className).toContain("omni-magnetic");
  });
});

describe("RippleSurface", () => {
  it("spawns a ripple element on mouse down", () => {
    render(
      <RippleSurface>
        <span>surface</span>
      </RippleSurface>,
    );
    const surface = screen.getByText("surface").parentElement as HTMLElement;
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 40 }) as DOMRect;
    fireEvent.mouseDown(surface, { clientX: 10, clientY: 10 });
    expect(surface.querySelector(".omni-ripple-circle")).not.toBeNull();
  });
});

describe("RouteTransition", () => {
  it("renders children and remounts when routeKey changes", () => {
    const { rerender } = render(
      <RouteTransition routeKey="/a">
        <span>page-a</span>
      </RouteTransition>,
    );
    expect(screen.getByText("page-a")).toBeTruthy();

    rerender(
      <RouteTransition routeKey="/b">
        <span>page-b</span>
      </RouteTransition>,
    );
    expect(screen.getByText("page-b")).toBeTruthy();
  });
});
