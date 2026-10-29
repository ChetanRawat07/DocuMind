import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../users/users.repository.js';

/** Request after AuthGuard has authenticated it. */
export interface AuthenticatedRequest extends Request {
  documindUser?: User;
}

/**
 * Injects the authenticated user. Throws (a 500) when used on a @Public()
 * route, because that is a programming error, not a client error.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().documindUser;
  if (!user) {
    throw new Error('@CurrentUser() used on a route that is not authenticated');
  }
  return user;
});
