import { z } from "zod";

/**
 * Runtime-validated mirror of @omniscience/types HealthCheckResponse.
 * Used at service boundaries (HTTP responses, tests) to catch
 * contract drift early, per Claude Development Rule 6.
 */
export const healthCheckResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  service: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.string().datetime(),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthCheckResponseSchema = z.infer<typeof healthCheckResponseSchema>;
