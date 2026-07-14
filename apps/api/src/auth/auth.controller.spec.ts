import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

describe("AuthController", () => {
  let controller: AuthController;
  const authService = {
    register: jest.fn(),
    verifyOtp: jest.fn(),
    resendOtp: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

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
});
