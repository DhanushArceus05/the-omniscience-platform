import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";

afterEach(() => {
  cleanup();
});

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hi">
        body
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders title, description and children when open", () => {
    render(
      <Modal open onClose={() => {}} title="Settings" description="Manage your account">
        <p>body content</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Manage your account")).toBeTruthy();
    expect(screen.getByText("body content")).toBeTruthy();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Settings">
        body
      </Modal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Settings">
        body
      </Modal>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Dialog", () => {
  it("renders confirm and cancel actions and wires them up", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <Dialog
        open
        onClose={onClose}
        title="Delete account"
        description="This cannot be undone."
        onConfirm={onConfirm}
        destructive
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    render(
      <Drawer open={false} onClose={() => {}}>
        panel
      </Drawer>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders content and title when open", () => {
    render(
      <Drawer open onClose={() => {}} title="Notifications">
        <p>panel content</p>
      </Drawer>,
    );
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("panel content")).toBeTruthy();
  });
});
