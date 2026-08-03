import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs, type TabItem } from "./Tabs";

afterEach(() => {
  cleanup();
});

const items: TabItem[] = [
  { key: "profile", label: "Profile", content: <p>Profile panel</p> },
  { key: "security", label: "Security", content: <p>Security panel</p> },
  { key: "sessions", label: "Sessions", content: <p>Sessions panel</p> },
  { key: "danger", label: "Danger Zone", content: <p>Danger panel</p> },
];

describe("Tabs", () => {
  it("renders every tab and only the active panel's content", () => {
    render(<Tabs items={items} activeKey="profile" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Profile" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Security" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sessions" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Danger Zone" })).toBeTruthy();
    expect(screen.getByText("Profile panel")).toBeTruthy();
    expect(screen.queryByText("Security panel")).toBeNull();
  });

  it("calls onChange when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} activeKey="profile" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Danger Zone" }));
    expect(onChange).toHaveBeenCalledWith("danger");
  });

  it("marks the active tab with aria-selected, and only the active one", () => {
    render(<Tabs items={items} activeKey="sessions" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Sessions" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("false");
  });

  it("renders the tab list in a single scrollable row rather than wrapping (see components.css `.omni-tabs__list`)", () => {
    const { container } = render(<Tabs items={items} activeKey="profile" onChange={() => {}} />);
    // Structural check standing in for the CSS this relies on (jsdom
    // doesn't compute real layout/overflow): all four tabs render as
    // flex-shrink:0 siblings of one `.omni-tabs__list` container, which
    // is what lets that single container scroll horizontally instead of
    // the tabs wrapping or forcing page-level overflow on a narrow
    // viewport.
    const list = container.querySelector(".omni-tabs__list");
    expect(list).toBeTruthy();
    expect(list?.children).toHaveLength(4);
  });
});
