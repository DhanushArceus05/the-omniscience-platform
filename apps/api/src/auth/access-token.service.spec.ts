import { JwtModule } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import type { Env } from "@omniscience/config";
import { AccessTokenService } from "./access-token.service";
import { ENV } from "../config/config.constants";

describe("AccessTokenService", () => {
  const env = {
    JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef",
    JWT_ACCESS_TTL_SECONDS: 900,
  } as unknown as Env;

  let service: AccessTokenService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: env.JWT_ACCESS_SECRET,
          signOptions: { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
        }),
      ],
      providers: [AccessTokenService, { provide: ENV, useValue: env }],
    }).compile();

    service = module.get(AccessTokenService);
  });

  it("signs a token that verify() can decode back to the same payload", async () => {
    const token = await service.sign({ sub: "user_1", email: "user@example.com" });
    const payload = await service.verify(token);

    expect(payload).toMatchObject({ sub: "user_1", email: "user@example.com" });
  });

  it("returns null for a malformed token instead of throwing", async () => {
    await expect(service.verify("not-a-real-token")).resolves.toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const otherModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: "a-completely-different-secret-value" })],
      providers: [AccessTokenService, { provide: ENV, useValue: env }],
    }).compile();
    const otherService: AccessTokenService = otherModule.get(AccessTokenService);

    const token = await otherService.sign({ sub: "user_1", email: "user@example.com" });

    await expect(service.verify(token)).resolves.toBeNull();
  });

  it("returns null for an expired token", async () => {
    const shortLivedModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: env.JWT_ACCESS_SECRET, signOptions: { expiresIn: "1ms" } })],
      providers: [
        AccessTokenService,
        { provide: ENV, useValue: { ...env, JWT_ACCESS_TTL_SECONDS: 0 } },
      ],
    }).compile();
    const shortLivedService: AccessTokenService = shortLivedModule.get(AccessTokenService);

    const token = await shortLivedService.sign({ sub: "user_1", email: "user@example.com" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(service.verify(token)).resolves.toBeNull();
  });

  it("exposes the configured TTL in seconds", () => {
    expect(service.expiresInSeconds).toBe(900);
  });
});
