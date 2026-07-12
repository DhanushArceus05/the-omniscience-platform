import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";
import { Dropdown } from "./Dropdown";
import { Tabs } from "./Tabs";

afterEach(() => {
  cleanup();
});

describe("Tooltip", () => {
  it("shows the label on hover and hides it on mouse leave", () => {
    render(
      <Tooltip label="Copy link">
        <button>Share</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(screen.getByText("Share").parentElement!.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toBe("Copy link");

    fireEvent.mouseLeave(screen.getByText("Share").parentElement!.parentElement!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("Dropdown", () => {
  it("opens the menu on trigger click and selects an item", () => {
    const onSelect = vi.fn();
    render(
      <Dropdown
        trigger={<button>Options</button>}
        items={[{ key: "delete", label: "Delete", onSelect }]}
      />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByText("Options"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onSelect).toHaveBeenCalled();
  });

  it("closes when clicking outside", () => {
    render(
      <div>
        <Dropdown trigger={<button>Options</button>} items={[{ key: "a", label: "A" }]} />
        <button>Outside</button>
      </div>,
    );
    fireEvent.click(screen.getByText("Options"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(screen.getByText("Outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Tabs", () => {
  it("renders the active tab's content and switches on click", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        activeKey="one"
        onChange={onChange}
        items={[
          { key: "one", label: "One", content: <p>Content one</p> },
          { key: "two", label: "Two", content: <p>Content two</p> },
        ]}
      />,
    );
    expect(screen.getByText("Content one")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(onChange).toHaveBeenCalledWith("two");
  });
});
