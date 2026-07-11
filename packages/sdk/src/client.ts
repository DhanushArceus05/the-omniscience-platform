import type { HealthCheckResponse } from "@omniscience/types";

export interface OmniscienceClientOptions {
  apiBaseUrl: string;
  aiServiceBaseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin typed client over the platform's HTTP services.
 * Phase 0 intentionally exposes only health checks; business
 * capability methods are added in later phases per the approved
 * roadmap (docs/08_Development_Roadmap.md).
 */
export class OmniscienceClient {
  private readonly apiBaseUrl: string;
  private readonly aiServiceBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OmniscienceClientOptions) {
    if (!options.apiBaseUrl) {
      throw new Error("OmniscienceClient requires apiBaseUrl");
    }
    if (!options.aiServiceBaseUrl) {
      throw new Error("OmniscienceClient requires aiServiceBaseUrl");
    }
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.aiServiceBaseUrl = options.aiServiceBaseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getApiHealth(): Promise<HealthCheckResponse> {
    return this.getJson<HealthCheckResponse>(`${this.apiBaseUrl}/health`);
  }

  async getAiServiceHealth(): Promise<HealthCheckResponse> {
    return this.getJson<HealthCheckResponse>(`${this.aiServiceBaseUrl}/health`);
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
