import { describe, expect, it } from "vitest";
import { healthCheckResponseSchema } from "./health";

describe("healthCheckResponseSchema", () => {
  it("accepts a well-formed payload", () => {
    const result = healthCheckResponseSchema.safeParse({
      status: "ok",
      service: "api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: 1.23,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid status value", () => {
    const result = healthCheckResponseSchema.safeParse({
      status: "unknown",
      service: "api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative uptime", () => {
    const result = healthCheckResponseSchema.safeParse({
      status: "ok",
      service: "api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: -5,
    });
    expect(result.success).toBe(false);
  });
});
