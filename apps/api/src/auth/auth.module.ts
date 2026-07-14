import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp.service";
import { PasswordHasherService } from "./password-hasher.service";
import { PendingRegistrationStore } from "./pending-registration.store";

/**
 * Authentication module.
 *
 * Step 2 foundation: `PasswordHasherService`.
 * Step 3 (this step): `OtpService` (code generation),
 * `PendingRegistrationStore` (Redis-backed pending registrations),
 * `AuthService` (orchestration), and `AuthController` — the first real
 * endpoints in this module: `POST /auth/register`,
 * `POST /auth/verify-otp`, `POST /auth/resend-otp`.
 *
 * `PrismaService`, `RedisService`, and `MailService` are available here
 * without an explicit import since their modules are all `@Global()`.
 *
 * No login/JWT/forgot-password endpoints yet — Step 4/5.
 */
@Module({
  controllers: [AuthController],
  providers: [PasswordHasherService, OtpService, PendingRegistrationStore, AuthService],
  exports: [PasswordHasherService],
})
export class AuthModule {}
