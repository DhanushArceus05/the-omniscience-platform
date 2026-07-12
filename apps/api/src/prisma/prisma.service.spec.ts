import { Test, TestingModule } from "@nestjs/testing";
import type { Logger } from "pino";
import { LOGGER } from "../config/config.constants";
import { PrismaService } from "./prisma.service";

const connect = jest.fn();
const disconnect = jest.fn();
const on = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: class {
    $connect = connect;
    $disconnect = disconnect;
    $on = on;
  },
}));

describe("PrismaService", () => {
  let service: PrismaService;
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, { provide: LOGGER, useValue: logger }],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it("connects and registers warn/error listeners on module init", async () => {
    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith("warn", expect.any(Function));
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(logger.info).toHaveBeenCalledWith("prisma connected to postgres");
  });

  it("logs prisma warn events through the injected logger", async () => {
    await service.onModuleInit();
    const warnHandler = on.mock.calls.find(([event]) => event === "warn")?.[1] as (e: {
      message: string;
    }) => void;

    warnHandler({ message: "slow query" });

    expect(logger.warn).toHaveBeenCalledWith({ err: "slow query" }, "prisma warning");
  });

  it("disconnects on module destroy", async () => {
    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("prisma disconnected from postgres");
  });
});
