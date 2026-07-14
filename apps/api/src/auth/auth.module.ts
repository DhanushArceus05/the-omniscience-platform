import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import type { Env } from "@omniscience/config";
import { ENV } from "../config/config.constants";
import { AccessTokenService } from "./access-token.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { OtpService } from "./otp.service";
import { PasswordHasherService } from "./password-hasher.service";
import { PendingRegistrationStore } from "./pending-registration.store";
import { RefreshTokenStore } from "./refresh-token.store";

/**
 * Authentication module.
 *
 * Step 2 foundation: `PasswordHasherService`.
 * Step 3: `OtpService`, `PendingRegistrationStore`, `AuthService`
 * (orchestration), `AuthController` — `POST /auth/register`,
 * `POST /auth/verify-otp`, `POST /auth/resend-otp`.
 * Step 4 (this step): `JwtModule` (registered async so it can read
 * `JWT_ACCESS_SECRET`/`JWT_ACCESS_TTL_SECONDS` from the validated `Env`
 * rather than `process.env` directly), `AccessTokenService` (signs/
 * verifies the access token), `RefreshTokenStore` (Redis-backed,
 * single-use refresh tokens), and `JwtAuthGuard` — new endpoints
 * `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`,
 * `GET /auth/me`.
 *
 * `PrismaService`, `RedisService`, and `MailService` are available here
 * without an explicit import since their modules are all `@Global()`.
 *
 * `AccessTokenService` and `JwtAuthGuard` are exported so a future
 * module can protect its own routes with the same guard without
 * re-implementing JWT verification.
 *
 * No forgot-password endpoints yet — Step 5.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    PasswordHasherService,
    OtpService,
    PendingRegistrationStore,
    AccessTokenService,
    RefreshTokenStore,
    JwtAuthGuard,
    AuthService,
  ],
  exports: [PasswordHasherService, AccessTokenService, JwtAuthGuard],
})
export class AuthModule {}
