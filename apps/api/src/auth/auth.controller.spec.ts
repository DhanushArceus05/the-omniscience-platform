import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

describe("AuthController", () => {
  let controller: AuthController;
  const authService = {
    register: jest.fn(),
    verifyOtp: jest.fn(),
    resendOtp: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    getCurrentUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      // These tests call controller methods directly, never through HTTP,
      // so the guard's own behavior is irrelevant here (it's covered by
      // jwt-auth.guard.spec.ts and the e2e spec) — but Nest still
      // resolves every provider `@UseGuards(JwtAuthGuard)` references at
      // module-compile time, so it must be satisfied one way or another.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it("register() delegates to AuthService and wraps the result in an ApiSuccess envelope", async () => {
    authService.register.mockResolvedValue({ email: "user@example.com", otpExpiresInSeconds: 600 });

    const result = await controller.register({
      email: "user@example.com",
      password: "Sup3r$ecretPassw0rd!",
      name: "Arceus",
    });

    expect(authService.register).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "Sup3r$ecretPassw0rd!",
      name: "Arceus",
    });
    expect(result).toEqual({
      success: true,
      data: { email: "user@example.com", otpExpiresInSeconds: 600 },
    });
  });

  it("verifyOtp() delegates to AuthService with email and otp", async () => {
    authService.verifyOtp.mockResolvedValue({ userId: "user_1", email: "user@example.com" });

    const result = await controller.verifyOtp({ email: "user@example.com", otp: "123456" });

    expect(authService.verifyOtp).toHaveBeenCalledWith("user@example.com", "123456");
    expect(result).toEqual({
      success: true,
      data: { userId: "user_1", email: "user@example.com" },
    });
  });

  it("resendOtp() delegates to AuthService with email", async () => {
    authService.resendOtp.mockResolvedValue({ email: "user@example.com", otpExpiresInSeconds: 600 });

    const result = await controller.resendOtp({ email: "user@example.com" });

    expect(authService.resendOtp).toHaveBeenCalledWith("user@example.com");
    expect(result).toEqual({
      success: true,
      data: { email: "user@example.com", otpExpiresInSeconds: 600 },
    });
  });

  it("login() delegates to AuthService with email and password", async () => {
    const loginResponse = {
      accessToken: "access.jwt.token",
      accessTokenExpiresInSeconds: 900,
      refreshToken: "token-id.secret",
      refreshTokenExpiresInSeconds: 604800,
      user: { id: "user_1", email: "user@example.com", name: "Arceus" },
    };
    authService.login.mockResolvedValue(loginResponse);

    const result = await controller.login({ email: "user@example.com", password: "correct-password" });

    expect(authService.login).toHaveBeenCalledWith("user@example.com", "correct-password");
    expect(result).toEqual({ success: true, data: loginResponse });
  });

  it("refresh() delegates to AuthService with the refresh token", async () => {
    const refreshResponse = {
      accessToken: "new.jwt.token",
      accessTokenExpiresInSeconds: 900,
      refreshToken: "new-token-id.new-secret",
      refreshTokenExpiresInSeconds: 604800,
    };
    authService.refresh.mockResolvedValue(refreshResponse);

    const result = await controller.refresh({ refreshToken: "token-id.secret" });

    expect(authService.refresh).toHaveBeenCalledWith("token-id.secret");
    expect(result).toEqual({ success: true, data: refreshResponse });
  });

  it("logout() delegates to AuthService with the refresh token", async () => {
    authService.logout.mockResolvedValue({ loggedOut: true });

    const result = await controller.logout({ refreshToken: "token-id.secret" });

    expect(authService.logout).toHaveBeenCalledWith("token-id.secret");
    expect(result).toEqual({ success: true, data: { loggedOut: true } });
  });

  it("me() delegates to AuthService with the current user's id from the verified token", async () => {
    authService.getCurrentUser.mockResolvedValue({
      id: "user_1",
      email: "user@example.com",
      name: "Arceus",
    });

    const result = await controller.me({ sub: "user_1", email: "user@example.com" });

    expect(authService.getCurrentUser).toHaveBeenCalledWith("user_1");
    expect(result).toEqual({
      success: true,
      data: { id: "user_1", email: "user@example.com", name: "Arceus" },
    });
  });
});
