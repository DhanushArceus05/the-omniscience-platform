import { Test, TestingModule } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import type { Logger } from "pino";
import { ENV, LOGGER } from "../config/config.constants";
import { RedisService } from "./redis.service";

const connect = jest.fn();
const disconnect = jest.fn();
const on = jest.fn();

jest.mock("ioredis", () => ({
  __esModule: true,
  default: class {
    connect = connect;
    disconnect = disconnect;
    on = on;
  },
}));

describe("RedisService", () => {
  let service: RedisService;
  const env = { REDIS_URL: "redis://localhost:6379" } as unknown as Env;
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: logger },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  it("registers an error listener on construction", () => {
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("connects on module init", async () => {
    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("redis connected");
  });

  it("disconnects on module destroy", () => {
    service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("redis disconnected");
  });

  it("exposes the underlying client via getClient()", () => {
    expect(service.getClient()).toBeDefined();
  });
});
