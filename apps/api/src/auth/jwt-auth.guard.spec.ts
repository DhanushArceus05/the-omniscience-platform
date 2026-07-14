import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AccessTokenService } from "./access-token.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

describe("JwtAuthGuard", () => {
  const accessTokens = { verify: jest.fn() } as unknown as AccessTokenService;
  let guard: JwtAuthGuard;

  function contextWithHeader(authorization?: string): ExecutionContext {
    const request: { headers: Record<string, string | undefined>; user?: unknown } = {
      headers: { authorization },
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard(accessTokens);
  });

  it("allows the request and attaches the verified payload as req.user", async () => {
    (accessTokens.verify as jest.Mock).mockResolvedValue({ sub: "user_1", email: "user@example.com" });
    const context = contextWithHeader("Bearer valid.jwt.token");

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(accessTokens.verify).toHaveBeenCalledWith("valid.jwt.token");
    expect((context.switchToHttp().getRequest() as { user: unknown }).user).toEqual({
      sub: "user_1",
      email: "user@example.com",
    });
  });

  it("throws UnauthorizedException when the Authorization header is missing", async () => {
    await expect(guard.canActivate(contextWithHeader(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(accessTokens.verify).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedException when the header doesn't use the Bearer scheme", async () => {
    await expect(guard.canActivate(contextWithHeader("Basic dXNlcjpwYXNz"))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(accessTokens.verify).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedException when the Bearer token is empty", async () => {
    await expect(guard.canActivate(contextWithHeader("Bearer "))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(accessTokens.verify).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedException when the token fails verification", async () => {
    (accessTokens.verify as jest.Mock).mockResolvedValue(null);

    await expect(guard.canActivate(contextWithHeader("Bearer invalid.token"))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
