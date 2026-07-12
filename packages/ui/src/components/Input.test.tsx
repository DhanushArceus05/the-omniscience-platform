import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "./Input";

afterEach(() => {
  cleanup();
});

describe("Input", () => {
  it("associates the label with the input", () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("shows helper text", () => {
    render(<Input label="Email" helperText="We'll never share this" />);
    expect(screen.getByText("We'll never share this")).toBeTruthy();
  });

  it("shows an error message and marks the input invalid", () => {
    render(<Input label="Email" error="Email is required" />);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Email is required");
  });

  it("prefers the error message over helper text when both are given", () => {
    render(<Input label="Email" helperText="helper" error="error" />);
    expect(screen.getByText("error")).toBeTruthy();
    expect(screen.queryByText("helper")).toBeNull();
  });
});
