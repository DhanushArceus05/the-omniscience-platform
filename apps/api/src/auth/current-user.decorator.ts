import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AccessTokenPayload } from "./access-token.service";
import type { AuthenticatedRequest } from "./jwt-auth.guard";

/**
 * Injects the verified access-token payload `JwtAuthGuard` attached to
 * the request. Only usable on routes already behind `@UseGuards(JwtAuthGuard)`
 * — there's no fallback/optional-auth mode in Step 4's scope.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
