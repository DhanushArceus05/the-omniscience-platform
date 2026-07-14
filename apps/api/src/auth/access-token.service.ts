import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Env } from "@omniscience/config";
import { ENV } from "../config/config.constants";

/** Everything an access token needs to carry — kept minimal on purpose (no roles/permissions yet, not in Step 4's scope). */
export interface AccessTokenPayload {
  sub: string;
  email: string;
}

/**
 * Signs and verifies the short-lived JWT access token (Phase 2 Step 4).
 *
 * The single place in the codebase that touches `@nestjs/jwt` directly,
 * mirroring `PasswordHasherService`/`OtpService`'s "one focused service
 * per primitive" convention. `JwtModule` (registered in `AuthModule`) is
 * already configured with `JWT_ACCESS_SECRET` and `JWT_ACCESS_TTL_SECONDS`,
 * so this service doesn't need to pass signing options itself.
 *
 * Refresh tokens are NOT handled here — they're opaque, Redis-backed
 * secrets (`RefreshTokenStore`), not JWTs, since they need to be
 * revocable and single-use in a way a stateless JWT can't be.
 */
@Injectable()
export class AccessTokenService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
  ) {}

  async sign(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload);
  }

  /** Verifies and decodes a token. Returns `null` for any invalid, expired, or malformed token — never throws. */
  async verify(token: string): Promise<AccessTokenPayload | null> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      return null;
    }
  }

  get expiresInSeconds(): number {
    return this.env.JWT_ACCESS_TTL_SECONDS;
  }
}
