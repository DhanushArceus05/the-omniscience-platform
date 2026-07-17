import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip } from "./Tooltip";

afterEach(() => {
  cleanup();
});

function hoverTrigger(triggerText: string): void {
  const trigger = screen.getByText(triggerText);
  const wrapper = trigger.closest(".omni-tooltip-wrapper");
  if (!wrapper) {
    throw new Error("Could not find .omni-tooltip-wrapper ancestor");
  }
  fireEvent.mouseEnter(wrapper);
}

describe("Tooltip", () => {
  it("defaults to centered alignment when no align prop is passed", () => {
    render(
      <Tooltip label="Notifications (coming soon)" placement="bottom">
        <button type="button">Bell</button>
      </Tooltip>,
    );
    hoverTrigger("Bell");
    expect(screen.getByRole("tooltip").className).toContain("omni-tooltip--align-center");
  });

  it('anchors to the trigger\'s right edge when align="end" is passed', () => {
    render(
      <Tooltip label="Notifications (coming soon)" placement="bottom" align="end">
        <button type="button">Bell</button>
      </Tooltip>,
    );
    hoverTrigger("Bell");
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("omni-tooltip--align-end");
    expect(tooltip.className).not.toContain("omni-tooltip--align-center");
  });

  it("still respects the placement prop independently of alignment", () => {
    render(
      <Tooltip label="Theme: dark. Click to switch." placement="bottom" align="end">
        <button type="button">Theme</button>
      </Tooltip>,
    );
    hoverTrigger("Theme");
    expect(screen.getByRole("tooltip").className).toContain("omni-tooltip--bottom");
  });
});
