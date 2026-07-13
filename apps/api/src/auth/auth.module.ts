import { Module } from "@nestjs/common";
import { PasswordHasherService } from "./password-hasher.service";

/**
 * Authentication module foundation (Phase 2 Step 2).
 *
 * Only wires what Step 2 actually needs: `PasswordHasherService`. No
 * controller is declared yet — there's nothing to expose until Step 3
 * (registration/OTP) and Step 4 (login/JWT) add real endpoints. Adding an
 * empty controller now would just be placeholder code with no behavior.
 *
 * `PrismaService` is available to this module (and any future
 * `AuthService`) without an explicit import, since `PrismaModule` is
 * `@Global()`.
 */
@Module({
  providers: [PasswordHasherService],
  exports: [PasswordHasherService],
})
export class AuthModule {}
