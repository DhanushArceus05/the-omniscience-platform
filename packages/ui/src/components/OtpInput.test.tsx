import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OtpInput } from "./OtpInput";

afterEach(() => {
  cleanup();
});

describe("OtpInput", () => {
  it("renders one box per digit", () => {
    render(<OtpInput value="" onChange={() => {}} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
  });

  it("advances focus to the next box after typing a digit", () => {
    render(<OtpInput value="" onChange={() => {}} />);
    const boxes = screen.getAllByRole("textbox");
    fireEvent.change(boxes[0] as HTMLInputElement, { target: { value: "4" } });
    expect(document.activeElement).toBe(boxes[1]);
  });

  it("calls onComplete once all digits are filled via paste", () => {
    const onComplete = vi.fn();
    render(<OtpInput value="" onChange={() => {}} onComplete={onComplete} />);
    const [firstBox] = screen.getAllByRole("textbox");

    fireEvent.paste(firstBox as HTMLInputElement, {
      clipboardData: { getData: () => "123456" },
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("shows an error message when provided", () => {
    render(<OtpInput value="" onChange={() => {}} error="Invalid code" />);
    expect(screen.getByRole("alert").textContent).toBe("Invalid code");
  });
});
