import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@omniscience/ui";
import type { ReactNode } from "react";
import { LoginPage } from "./LoginPage";
import { ResetPasswordPage } from "./ResetPasswordPage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderWithProviders(children: ReactNode) {
  return render(
    <MemoryRouter>
      <ToastProvider>{children}</ToastProvider>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("shows a preview-only toast after submitting, without calling any backend", () => {
    vi.useFakeTimers();
    renderWithProviders(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

    act(() => {
      vi.advanceTimersByTime(700);
    });

    expect(screen.getByText("Preview only")).toBeTruthy();
  });
});

describe("ResetPasswordPage", () => {
  it("disables submission and shows an error when the passwords don't match", () => {
    renderWithProviders(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "abcdefgh" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "different" } });

    expect(screen.getByText("Passwords do not match")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password" })).toHaveProperty("disabled", true);
  });

  it("enables submission once both passwords match", () => {
    renderWithProviders(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "abcdefgh" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "abcdefgh" } });

    expect(screen.queryByText("Passwords do not match")).toBeNull();
    expect(screen.getByRole("button", { name: "Reset password" })).toHaveProperty("disabled", false);
  });
});
