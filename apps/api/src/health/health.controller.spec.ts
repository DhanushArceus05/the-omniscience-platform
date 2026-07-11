import { Test, TestingModule } from "@nestjs/testing";
import type { HealthCheckResponse } from "@omniscience/types";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

describe("HealthController", () => {
  let controller: HealthController;

  const mockResponse: HealthCheckResponse = {
    status: "ok",
    service: "api",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    uptimeSeconds: 5,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: { getHealth: jest.fn().mockReturnValue(mockResponse) },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it("returns the raw health payload from the service", () => {
    expect(controller.getHealth()).toEqual(mockResponse);
  });
});
