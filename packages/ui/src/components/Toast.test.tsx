import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "./Toast";
import { Alert } from "./Alert";

afterEach(() => {
  cleanup();
});

function ToastTrigger() {
  const { showToast } = useToast();
  return (
    <button
      onClick={() =>
        showToast({ title: "Saved", description: "Your changes were saved.", tone: "success" })
      }
    >
      Trigger
    </button>
  );
}

describe("ToastProvider / useToast", () => {
  it("shows a toast when showToast is called", () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Trigger"));
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("Your changes were saved.")).toBeTruthy();
  });

  it("dismisses a toast when its close button is clicked", () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("throws when useToast is used outside a provider", () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ToastProvider/);
  });
});

describe("Alert", () => {
  it("renders the title and children with an error role for the error tone", () => {
    render(
      <Alert tone="error" title="Something went wrong">
        Please try again.
      </Alert>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("Please try again.")).toBeTruthy();
  });

  it("uses a status role for non-error tones", () => {
    render(<Alert tone="info">Heads up.</Alert>);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
