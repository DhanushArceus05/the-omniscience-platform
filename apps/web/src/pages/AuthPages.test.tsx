import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "@omniscience/ui";
import type { JSX, ReactNode } from "react";
import { OmniscienceClient, ApiClientError } from "@omniscience/sdk";
import { AuthProvider } from "../lib/auth/AuthContext";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { VerifyOtpPage } from "./VerifyOtpPage";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { ResetPasswordPage } from "./ResetPasswordPage";

/**
 * `AuthProvider` builds a real `OmniscienceClient`; every test in this
 * file replaces its constructor with a mock so pages exercise their real
 * fetch-calling code paths (register/login/verifyOtp/etc.) against a
 * controlled response, instead of either hitting the network or falling
 * back to the old preview-only timers.
 */
vi.mock("@omniscience/sdk", async () => {
  const actual = await vi.importActual<typeof import("@omniscience/sdk")>("@omniscience/sdk");
  return {
    ...actual,
    OmniscienceClient: vi.fn(),
  };
});

const mockedClientCtor = vi.mocked(OmniscienceClient);

function mockClient(overrides: Record<string, ReturnType<typeof vi.fn>>) {
  mockedClientCtor.mockImplementation(() => overrides as unknown as OmniscienceClient);
}

/**
 * Small probe screen so tests can assert both that navigation happened
 * AND what router state it carried (e.g. the email handed from
 * RegisterPage to VerifyOtpPage), without depending on the target
 * page's own internals.
 */
function LocationProbe({ label }: { label: string }): JSX.Element {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;
  return <div>{email ? `${label}:${email}` : label}</div>;
}

function renderAt(entry: string | { pathname: string; state?: unknown }, routes: ReactNode) {
  window.localStorage.clear();
  return render(
    <AuthProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>{routes}</Routes>
        </MemoryRouter>
      </ToastProvider>
    </AuthProvider>,
  );
}

/** Finds the 6 individual OTP digit boxes rendered by `OtpInput`. */
function getOtpBoxes(): HTMLElement[] {
  return screen.getAllByRole("textbox").filter((el) => el.getAttribute("maxlength") === "1");
}

function fillOtp(code: string): void {
  const boxes = getOtpBoxes();
  code.split("").forEach((digit, index) => {
    fireEvent.change(boxes[index] as HTMLInputElement, { target: { value: digit } });
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mockedClientCtor.mockReset();
  window.localStorage.clear();
});

describe("RegisterPage", () => {
  it("calls the real /auth/register endpoint and navigates to verify-otp with the email on success", async () => {
    const register = vi.fn().mockResolvedValue({ email: "person@example.com", otpExpiresInSeconds: 600 });
    mockClient({ register });

    renderAt(
      "/register",
      <>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-otp" element={<LocationProbe label="verify-otp" />} />
      </>,
    );

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Person Name" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Sup3r!Secret" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        name: "Person Name",
        email: "person@example.com",
        password: "Sup3r!Secret",
      }),
    );
    await waitFor(() => expect(screen.getByText("verify-otp:person@example.com")).toBeTruthy());
  });

  it("shows field-level validation errors and never calls the backend for an invalid form", () => {
    const register = vi.fn();
    mockClient({ register });

    renderAt("/register", <Route path="/register" element={<RegisterPage />} />);

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "P" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it("shows a backend error message when the email is already registered", async () => {
    const register = vi.fn().mockRejectedValue(
      new ApiClientError({
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account with this email already exists.",
        status: 409,
      }),
    );
    mockClient({ register });

    renderAt("/register", <Route path="/register" element={<RegisterPage />} />);

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Person Name" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "taken@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Sup3r!Secret" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    await waitFor(() =>
      expect(
        screen.getByText("An account with this email already exists. Try signing in instead."),
      ).toBeTruthy(),
    );
  });
});

describe("LoginPage", () => {
  it("calls the real /auth/login endpoint, persists the session, and navigates to /app on success", async () => {
    const loginResponse = {
      accessToken: "access-token",
      accessTokenExpiresInSeconds: 900,
      refreshToken: "refresh-token",
      refreshTokenExpiresInSeconds: 604_800,
      user: { id: "user-1", email: "person@example.com", name: "Person Name" },
    };
    const login = vi.fn().mockResolvedValue(loginResponse);
    mockClient({ login });

    renderAt(
      "/login",
      <>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<div>App shell</div>} />
      </>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2-Secret!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("App shell")).toBeTruthy());
    expect(login).toHaveBeenCalledWith({ email: "person@example.com", password: "hunter2-Secret!" });

    const stored = JSON.parse(window.localStorage.getItem("omniscience.auth.session") ?? "null");
    expect(stored?.accessToken).toBe("access-token");
    expect(stored?.user?.email).toBe("person@example.com");
  });

  it("redirects to verify-otp when the backend reports the email isn't verified", async () => {
    const login = vi.fn().mockRejectedValue(
      new ApiClientError({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified.", status: 403 }),
    );
    mockClient({ login });

    renderAt(
      "/login",
      <>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify-otp" element={<LocationProbe label="verify-otp" />} />
      </>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2-Secret!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("verify-otp:person@example.com")).toBeTruthy());
  });

  it("shows an error message for invalid credentials and does not navigate", async () => {
    const login = vi.fn().mockRejectedValue(
      new ApiClientError({ code: "INVALID_CREDENTIALS", message: "Invalid credentials.", status: 401 }),
    );
    mockClient({ login });

    renderAt("/login", <Route path="/login" element={<LoginPage />} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2-Secret!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Incorrect email or password.")).toBeTruthy());
  });
});

describe("VerifyOtpPage", () => {
  it("prompts to register again when no email was passed via navigation state", () => {
    renderAt("/verify-otp", <Route path="/verify-otp" element={<VerifyOtpPage />} />);
    expect(screen.getByText(/couldn't find a registration in progress/i)).toBeTruthy();
  });

  it("verifies the OTP against the backend and navigates to /login on success", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ userId: "user-1", email: "person@example.com" });
    mockClient({ verifyOtp });

    renderAt(
      { pathname: "/verify-otp", state: { email: "person@example.com" } },
      <>
        <Route path="/verify-otp" element={<VerifyOtpPage />} />
        <Route path="/login" element={<div>Sign in screen</div>} />
      </>,
    );

    fillOtp("123456");

    await waitFor(() =>
      expect(verifyOtp).toHaveBeenCalledWith({ email: "person@example.com", otp: "123456" }),
    );
    await waitFor(() => expect(screen.getByText("Sign in screen")).toBeTruthy());
  });

  it("shows an inline OTP error and stays on the page when the code is incorrect", async () => {
    const verifyOtp = vi.fn().mockRejectedValue(
      new ApiClientError({ code: "OTP_INCORRECT", message: "The verification code is incorrect.", status: 400 }),
    );
    mockClient({ verifyOtp });

    renderAt(
      { pathname: "/verify-otp", state: { email: "person@example.com" } },
      <Route path="/verify-otp" element={<VerifyOtpPage />} />,
    );

    fillOtp("000000");

    await waitFor(() => expect(screen.getByText("That code isn't correct. Please try again.")).toBeTruthy());
  });

  it("calls resend-otp when the resend action is used", async () => {
    const resendOtp = vi.fn().mockResolvedValue({ email: "person@example.com", otpExpiresInSeconds: 600 });
    mockClient({ resendOtp, verifyOtp: vi.fn() });

    renderAt(
      { pathname: "/verify-otp", state: { email: "person@example.com" } },
      <Route path="/verify-otp" element={<VerifyOtpPage />} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resend" }));

    await waitFor(() => expect(resendOtp).toHaveBeenCalledWith({ email: "person@example.com" }));
  });
});

describe("ForgotPasswordPage", () => {
  it("calls /auth/forgot-password and offers a path into reset-password with the email", async () => {
    const forgotPassword = vi.fn().mockResolvedValue({ email: "person@example.com", otpExpiresInSeconds: 600 });
    mockClient({ forgotPassword });

    renderAt(
      "/forgot-password",
      <>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<LocationProbe label="reset-password" />} />
      </>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send reset code" }).closest("form")!);

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith({ email: "person@example.com" }));
    await waitFor(() =>
      expect(within(screen.getByRole("status")).getByText("Check your inbox")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "I have my code" }));
    expect(screen.getByText("reset-password:person@example.com")).toBeTruthy();
  });
});

describe("ResetPasswordPage", () => {
  it("disables submission and shows an error when the passwords don't match", () => {
    renderAt("/reset-password", <Route path="/reset-password" element={<ResetPasswordPage />} />);

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Abcdefgh1!" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "different" } });

    expect(screen.getByText("Passwords do not match")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password" })).toHaveProperty("disabled", true);
  });

  it("enables submission once both passwords match", () => {
    renderAt("/reset-password", <Route path="/reset-password" element={<ResetPasswordPage />} />);

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Abcdefgh1!" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Abcdefgh1!" } });

    expect(screen.queryByText("Passwords do not match")).toBeNull();
    expect(screen.getByRole("button", { name: "Reset password" })).toHaveProperty("disabled", false);
  });

  it("calls /auth/reset-password with email/otp/newPassword and navigates to /login on success", async () => {
    const resetPassword = vi.fn().mockResolvedValue({ email: "person@example.com" });
    mockClient({ resetPassword });

    renderAt(
      { pathname: "/reset-password", state: { email: "person@example.com" } },
      <>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Sign in screen</div>} />
      </>,
    );

    fillOtp("123456");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Abcdefgh1!" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Abcdefgh1!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Reset password" }).closest("form")!);

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({
        email: "person@example.com",
        otp: "123456",
        newPassword: "Abcdefgh1!",
      }),
    );
    await waitFor(() => expect(screen.getByText("Sign in screen")).toBeTruthy());
  });
});
