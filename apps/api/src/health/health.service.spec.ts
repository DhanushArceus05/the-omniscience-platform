import { Test, TestingModule } from "@nestjs/testing";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it("returns status ok", () => {
    const result = service.getHealth();
    expect(result.status).toBe("ok");
  });

  it("returns the api service name", () => {
    const result = service.getHealth();
    expect(result.service).toBe("api");
  });

  it("returns a non-negative uptime", () => {
    const result = service.getHealth();
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("returns a valid ISO timestamp", () => {
    const result = service.getHealth();
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });
});
