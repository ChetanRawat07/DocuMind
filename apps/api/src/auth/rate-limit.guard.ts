import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './current-user.decorator.js';

/** Requests per user per window. `requests` applies to every authenticated route. */
export const RATE_LIMITS = {
  requests: { limit: 300, windowMs: 60_000 },
  // Each of these starts OCR and AI work, and an upload buffers up to 10 MiB.
  processing: { limit: 10, windowMs: 60_000 },
} as const;
export type RateLimitName = keyof typeof RATE_LIMITS;

const RATE_LIMIT = 'documind:rateLimit';

/** Adds a stricter limit; routes with the same name share one counter per user. */
export const RateLimit = (name: Exclude<RateLimitName, 'requests'>): MethodDecorator =>
  SetMetadata(RATE_LIMIT, name);

/**
 * Per-user fixed-window limits. Registered after AuthGuard, so the user is
 * known and a request without a valid token never counts. Keyed by user id,
 * not IP: behind the host's proxy every client would share one address.
 *
 * shortcut: counters live in this process's memory; with more than one API
 * instance each enforces its own limit. Move them to a shared store then.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private nextSweepAt = 0;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const user = http.getRequest<AuthenticatedRequest>().documindUser;
    // Only @Public() routes get here without a user: AuthGuard rejects the rest.
    if (!user) return true;

    const now = Date.now();
    this.sweep(now);
    const extra = this.reflector.get<RateLimitName | undefined>(RATE_LIMIT, context.getHandler());
    for (const name of extra ? (['requests', extra] as const) : (['requests'] as const)) {
      const { limit, windowMs } = RATE_LIMITS[name];
      const key = `${name}:${user.id}`;
      let window = this.windows.get(key);
      if (!window || window.resetAt <= now) {
        window = { count: 0, resetAt: now + windowMs };
        this.windows.set(key, window);
      }
      window.count += 1;
      if (window.count > limit) {
        const seconds = Math.ceil((window.resetAt - now) / 1000);
        http.getResponse<Response>().setHeader('Retry-After', String(seconds));
        throw new HttpException(
          `Too many requests. Try again in ${String(seconds)} seconds.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }

  /** Drops expired windows once a minute, so memory follows recently active users. */
  private sweep(now: number): void {
    if (now < this.nextSweepAt) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    this.nextSweepAt = now + 60_000;
  }
}
