import { describe, expect, it } from "vitest";
import type { ApiResponse, HealthCheckResponse } from "./health";

describe("HealthCheckResponse shape", () => {
  it("accepts a valid ok payload", () => {
    const payload: HealthCheckResponse = {
      status: "ok",
      service: "api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: 12.5,
    };
    expect(payload.status).toBe("ok");
  });
});

describe("ApiResponse envelope", () => {
  it("discriminates between success and error variants", () => {
    const success: ApiResponse<{ id: string }> = { success: true, data: { id: "abc" } };
    const failure: ApiResponse<{ id: string }> = {
      success: false,
      error: { code: "NOT_FOUND", message: "missing" },
    };

    expect(success.success).toBe(true);
    expect(failure.success).toBe(false);
    if (!failure.success) {
      expect(failure.error.code).toBe("NOT_FOUND");
    }
  });
});
