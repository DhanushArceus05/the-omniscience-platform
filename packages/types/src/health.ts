/**
 * Standard health-check response shape returned by every service
 * (apps/api, apps/ai-service) so the web app and monitoring tools
 * can rely on a single contract.
 */
export type ServiceStatus = "ok" | "degraded" | "down";

export interface HealthCheckResponse {
  status: ServiceStatus;
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
}

/**
 * Generic success/error envelope for API responses.
 * Business modules in later phases must conform to this shape.
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
