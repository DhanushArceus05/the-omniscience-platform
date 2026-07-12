import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdaptiveBackground } from "./AdaptiveBackground";

afterEach(() => {
  cleanup();
});

describe("AdaptiveBackground", () => {
  it("renders without throwing when no 2D context is available (jsdom default)", () => {
    const { container } = render(<AdaptiveBackground />);
    expect(container.querySelector(".omni-background")).not.toBeNull();
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("renders grid and noise overlays by default", () => {
    const { container } = render(<AdaptiveBackground />);
    expect(container.querySelector(".omni-background__grid")).not.toBeNull();
    expect(container.querySelector(".omni-background__noise")).not.toBeNull();
  });

  it("omits overlays when disabled via props", () => {
    const { container } = render(<AdaptiveBackground showGrid={false} showNoise={false} />);
    expect(container.querySelector(".omni-background__grid")).toBeNull();
    expect(container.querySelector(".omni-background__noise")).toBeNull();
  });

  it("is marked aria-hidden so it never interferes with assistive tech", () => {
    const { container } = render(<AdaptiveBackground />);
    expect(container.querySelector(".omni-background")?.getAttribute("aria-hidden")).toBe("true");
  });
});
