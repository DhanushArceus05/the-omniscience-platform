import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

describe("UsersController", () => {
  let controller: UsersController;
  const usersService = {
    updateProfile: jest.fn(),
    changePassword: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    })
      // Same rationale as auth.controller.spec.ts: these tests call
      // controller methods directly, never through HTTP, so the guard's
      // own behavior is irrelevant here (covered by jwt-auth.guard.spec.ts
      // and the e2e spec) — but Nest still resolves every provider
      // `@UseGuards(JwtAuthGuard)` references at module-compile time.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it("updateProfile() delegates to UsersService with the caller's own id and wraps the result", async () => {
    usersService.updateProfile.mockResolvedValue({
      id: "user_1",
      email: "user@example.com",
      name: "New Name",
    });

    const result = await controller.updateProfile({ sub: "user_1", email: "user@example.com" }, {
      name: "New Name",
    });

    expect(usersService.updateProfile).toHaveBeenCalledWith("user_1", "New Name");
    expect(result).toEqual({
      success: true,
      data: { id: "user_1", email: "user@example.com", name: "New Name" },
    });
  });

  it("changePassword() delegates to UsersService with the caller's own id and wraps the result", async () => {
    usersService.changePassword.mockResolvedValue({ email: "user@example.com" });

    const result = await controller.changePassword(
      { sub: "user_1", email: "user@example.com" },
      { currentPassword: "OldPassw0rd!", newPassword: "N3wSup3r$ecretPassw0rd!" },
    );

    expect(usersService.changePassword).toHaveBeenCalledWith(
      "user_1",
      "OldPassw0rd!",
      "N3wSup3r$ecretPassw0rd!",
    );
    expect(result).toEqual({ success: true, data: { email: "user@example.com" } });
  });
});
