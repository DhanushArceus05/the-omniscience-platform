import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatComposer } from "./ChatComposer";

afterEach(() => {
  cleanup();
});

describe("ChatComposer", () => {
  it("sends the trimmed content and clears the field when Send is clicked", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} isStreaming={false} />);

    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "  Hello  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("  Hello  ");
    expect(textarea.value).toBe("");
  });

  it("sends on Enter without Shift", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} isStreaming={false} />);

    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSend).toHaveBeenCalledWith("Hello");
  });

  it("does not send on Shift+Enter — inserts a newline instead", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} isStreaming={false} />);

    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the Send button while the input is empty or whitespace-only", () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);

    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not call onSend on Enter while empty", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} isStreaming={false} />);
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows Stop instead of Send while streaming, and calls onStop when clicked", () => {
    const onStop = vi.fn();
    render(<ChatComposer onSend={vi.fn()} onStop={onStop} isStreaming={true} />);

    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("disables the textarea when disabled prop is true", () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} disabled />);
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
