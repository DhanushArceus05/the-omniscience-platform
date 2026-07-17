import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdaptiveBackground,
  BACKGROUND_FRAME_INTERVAL_MS,
  shouldRenderFrame,
} from "./AdaptiveBackground";

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

describe("shouldRenderFrame", () => {
  // Regression tests for the flashing-rectangle compositing artifact:
  // repainting this canvas on every requestAnimationFrame tick forced
  // every backdrop-filter surface above it (sidebar, glass cards) to
  // resample continuously, which on high refresh-rate displays overloaded
  // the compositor and briefly showed unpainted tiles. shouldRenderFrame
  // throttles repaints to a fixed cadence, independent of display refresh
  // rate, without needing a real canvas context.

  it("renders the first frame immediately regardless of timestamp", () => {
    const result = shouldRenderFrame(16.7, null);
    expect(result.shouldRender).toBe(true);
  });

  it("skips a frame that arrives before the target interval has elapsed", () => {
    // On a 120Hz+ display, consecutive rAF ticks can be ~8ms apart, well
    // under the ~33.3ms (30fps) throttle interval.
    const first = shouldRenderFrame(0, null);
    const second = shouldRenderFrame(8, first.nextFrameTime);
    expect(second.shouldRender).toBe(false);
    // Skipped frames must not advance the reference time, or every tick
    // would reset the window and the throttle would never engage.
    expect(second.nextFrameTime).toBe(first.nextFrameTime);
  });

  it("renders again once the target interval has elapsed", () => {
    const first = shouldRenderFrame(0, null);
    const later = shouldRenderFrame(BACKGROUND_FRAME_INTERVAL_MS + 1, first.nextFrameTime);
    expect(later.shouldRender).toBe(true);
  });

  it("caps effective repaint rate independent of how often it's called", () => {
    // Simulate a 144Hz display calling this every ~6.94ms for one second
    // and count how many frames actually render.
    let lastFrameTime: number | null = null;
    let rendered = 0;
    const tickMs = 1000 / 144;
    for (let t = 0; t < 1000; t += tickMs) {
      const result = shouldRenderFrame(t, lastFrameTime);
      if (result.shouldRender) {
        rendered += 1;
        lastFrameTime = result.nextFrameTime;
      }
    }
    // Should render roughly BACKGROUND_TARGET_FPS times per second, not
    // ~144 times.
    expect(rendered).toBeLessThan(40);
    expect(rendered).toBeGreaterThan(20);
  });
});
