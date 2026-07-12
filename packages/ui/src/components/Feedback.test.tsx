import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Spinner } from "./Spinner";
import { Skeleton } from "./Skeleton";
import { Progress } from "./Progress";

afterEach(() => {
  cleanup();
});

describe("Spinner", () => {
  it("exposes a status role with an accessible label", () => {
    render(<Spinner label="Loading results" />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Loading results");
  });
});

describe("Skeleton", () => {
  it("renders a hidden placeholder element", () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector(".omni-skeleton");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Progress", () => {
  it("clamps values above 100", () => {
    render(<Progress value={140} label="Upload" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("clamps values below 0", () => {
    render(<Progress value={-20} label="Upload" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  it("passes through a normal value", () => {
    render(<Progress value={42} label="Upload" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
  });
});
