import { Test, TestingModule } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import type { Logger } from "pino";
import { ENV, LOGGER } from "../config/config.constants";
import { MongoService } from "./mongo.service";

const connect = jest.fn();
const close = jest.fn();
const on = jest.fn();
const db = jest.fn(() => ({ databaseName: "test" }));

jest.mock("mongodb", () => ({
  __esModule: true,
  MongoClient: class {
    connect = connect;
    close = close;
    on = on;
    db = db;
  },
}));

describe("MongoService", () => {
  let service: MongoService;
  const env = { MONGO_URL: "mongodb://localhost:27017/test" } as unknown as Env;
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MongoService,
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: logger },
      ],
    }).compile();

    service = module.get<MongoService>(MongoService);
  });

  it("registers an error listener on construction", () => {
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("connects on module init", async () => {
    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("mongo connected");
  });

  it("disconnects on module destroy", async () => {
    await service.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("mongo disconnected");
  });

  it("exposes the underlying database handle via getDb()", () => {
    expect(service.getDb()).toBeDefined();
  });
});
