import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import {
  AccessTokenVerifier,
  AuthProviderUnavailableError,
  InvalidAccessTokenError,
} from './access-token-verifier.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { IS_PUBLIC } from './public.decorator.js';
import { UserProvisioningService } from './user-provisioning.service.js';

/** RFC 6750 b64token after the scheme. Anything else is not a bearer credential. */
const BEARER_PATTERN = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;

/**
 * Global guard: authenticates every request unless the route is @Public().
 * Authorization of individual resources (ownership) happens in the data
 * layer, which filters every query by the authenticated user's id.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
    private readonly provisioning: UserProvisioningService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const token = BEARER_PATTERN.exec(request.headers.authorization ?? '')?.[1];
    if (!token) {
      response.setHeader('WWW-Authenticate', 'Bearer realm="documind"');
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const identity = await this.verifier.verify(token);
      request.documindUser = await this.provisioning.resolve(identity);
      return true;
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        response.setHeader('WWW-Authenticate', 'Bearer realm="documind", error="invalid_token"');
        throw new UnauthorizedException(error.message);
      }
      if (error instanceof AuthProviderUnavailableError) {
        // The cause describes the key fetch (timeout, connection refused), never the token.
        const cause = error.cause instanceof Error ? error.cause.message : 'unknown cause';
        this.logger.error(`Could not load token signing keys: ${cause}`);
        throw new ServiceUnavailableException('Authentication temporarily unavailable', {
          cause: error,
        });
      }
      throw error;
    }
  }
}
