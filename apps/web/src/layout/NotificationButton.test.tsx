import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NotificationButton } from "./NotificationButton";

afterEach(() => {
  cleanup();
});

describe("NotificationButton", () => {
  it("anchors its tooltip to the button's right edge instead of centering it", () => {
    // Regression test: centering this tooltip on the bell button (the
    // second-to-last icon in the header's action row) let the wide,
    // nowrap "Notifications (coming soon)" label extend past the right
    // viewport edge, intermittently growing the document's scrollable
    // width and producing a flickering scrollbar as the tooltip toggled
    // visible while the pointer moved through the header.
    render(<NotificationButton />);
    const button = screen.getByLabelText("Notifications");
    const wrapper = button.closest(".omni-tooltip-wrapper");
    if (!wrapper) {
      throw new Error("Could not find .omni-tooltip-wrapper ancestor");
    }
    fireEvent.mouseEnter(wrapper);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("omni-tooltip--align-end");
    expect(tooltip.className).not.toContain("omni-tooltip--align-center");
  });
});
