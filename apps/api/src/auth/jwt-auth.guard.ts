import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AccessTokenService, type AccessTokenPayload } from "./access-token.service";

const BEARER_PREFIX = "Bearer ";

/** Augments Express's `Request` with the identity `JwtAuthGuard` attaches once a token verifies. */
export interface AuthenticatedRequest extends Request {
  user: AccessTokenPayload;
}

/**
 * Protects a route with the Phase 2 Step 4 JWT access token.
 *
 * Hand-rolled rather than pulling in `@nestjs/passport` + `passport-jwt`:
 * the check is a single "extract Bearer token, verify, attach payload"
 * step, so a dedicated dependency and its strategy-registration
 * boilerplate would add surface area without adding capability —
 * consistent with `ZodValidationPipe` already being hand-rolled instead
 * of pulling in `nestjs-zod`.
 *
 * Always throws the same generic `401 UNAUTHORIZED` regardless of
 * *why* the token failed (missing header, malformed, expired, wrong
 * signature) — none of those distinctions are useful to a client beyond
 * "you're not authenticated", and they're never useful to an attacker.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) {
      throw this.unauthorized();
    }

    const payload = await this.accessTokens.verify(token);
    if (!payload) {
      throw this.unauthorized();
    }

    request.user = payload;
    return true;
  }

  private extractToken(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      return null;
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    return token.length > 0 ? token : null;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: "UNAUTHORIZED",
      message: "A valid access token is required.",
    });
  }
}
