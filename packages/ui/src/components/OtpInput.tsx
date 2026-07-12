import { useRef, type ClipboardEvent, type JSX, type KeyboardEvent } from "react";

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  /** Called when the value reaches full length. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  error?: string;
  label?: string;
}

/**
 * Six-digit (configurable) one-time-passcode input. UI only — no
 * verification logic. Digits auto-advance on entry, backspace moves
 * focus back, and pasting a full code fills every box at once.
 */
export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  error,
  label = "Verification code",
}: OtpInputProps): JSX.Element {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  function setDigit(index: number, digit: string): void {
    const next = digits.slice();
    next[index] = digit;
    const nextValue = next.join("");
    onChange(nextValue);
    if (nextValue.length === length && !nextValue.includes("")) {
      onComplete?.(nextValue);
    }
  }

  function handleChange(index: number, raw: string): void {
    const digit = raw.replace(/\D/g, "").slice(-1);
    setDigit(index, digit);
    if (digit && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>): void {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted.padEnd(length, ""));
    if (pasted.length === length) {
      onComplete?.(pasted);
      inputsRef.current[length - 1]?.focus();
    } else {
      inputsRef.current[pasted.length]?.focus();
    }
  }

  return (
    <div className="omni-field">
      <span className="omni-field__label" id="omni-otp-label">
        {label}
      </span>
      <div className="omni-otp" role="group" aria-labelledby="omni-otp-label">
        {digits.map((digit, index) => (
          <input
            key={`otp-digit-${index}`}
            ref={(el) => {
              inputsRef.current[index] = el;
            }}
            className="omni-otp__digit"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={digit}
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            aria-label={`Digit ${index + 1} of ${length}`}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
          />
        ))}
      </div>
      {error && (
        <span className="omni-field__helper omni-field__helper--error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
