import { Test, TestingModule } from "@nestjs/testing";
import { AuthModule } from "./auth.module";
import { PasswordHasherService } from "./password-hasher.service";

describe("AuthModule", () => {
  it("compiles and provides PasswordHasherService", async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();

    expect(module.get(PasswordHasherService)).toBeInstanceOf(PasswordHasherService);
  });
});
