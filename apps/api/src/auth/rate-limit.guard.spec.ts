import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RATE_LIMITS, RateLimit, RateLimitGuard } from './rate-limit.guard.js';

class Routes {
  read(): void {}
  @RateLimit('processing')
  upload(): void {}
  @RateLimit('processing')
  reprocess(): void {}
}

function contextFor(handler: keyof Routes, userId: string | null) {
  const headers = new Map<string, string>();
  const context = {
    // Reflector reads the decorator's metadata from the function itself; it is never called.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    getHandler: () => Routes.prototype[handler],
    switchToHttp: () => ({
      getRequest: () => ({ documindUser: userId ? { id: userId } : undefined }),
      getResponse: () => ({ setHeader: (name: string, value: string) => headers.set(name, value) }),
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

function status(guard: RateLimitGuard, handler: keyof Routes, userId: string | null = 'u1') {
  const { context, headers } = contextFor(handler, userId);
  try {
    guard.canActivate(context);
    return { status: 200, retryAfter: headers.get('Retry-After') };
  } catch (error) {
    return { status: (error as HttpException).getStatus(), retryAfter: headers.get('Retry-After') };
  }
}

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-03T10:00:00Z') });
    guard = new RateLimitGuard(new Reflector());
  });
  afterEach(() => vi.useRealTimers());

  it('allows the limit, then answers 429 with Retry-After until the window resets', () => {
    for (let i = 0; i < RATE_LIMITS.requests.limit; i += 1) {
      expect(status(guard, 'read').status).toBe(200);
    }
    vi.advanceTimersByTime(20_000);
    expect(status(guard, 'read')).toEqual({ status: 429, retryAfter: '40' });

    vi.advanceTimersByTime(40_000);
    expect(status(guard, 'read').status).toBe(200);
  });

  it('counts each user separately', () => {
    for (let i = 0; i < RATE_LIMITS.processing.limit; i += 1) status(guard, 'upload', 'u1');
    expect(status(guard, 'upload', 'u1').status).toBe(429);
    expect(status(guard, 'upload', 'u2').status).toBe(200);
  });

  it('shares the stricter limit across routes and still allows other routes', () => {
    for (let i = 0; i < RATE_LIMITS.processing.limit; i += 1) status(guard, 'upload');
    expect(status(guard, 'reprocess').status).toBe(429);
    expect(status(guard, 'read').status).toBe(200);
  });

  it('counts stricter routes toward the general limit too', () => {
    for (let i = 0; i < RATE_LIMITS.requests.limit - 1; i += 1) status(guard, 'read');
    expect(status(guard, 'upload').status).toBe(200);
    expect(status(guard, 'read').status).toBe(429);
  });

  it('does not limit public routes, which have no user', () => {
    for (let i = 0; i <= RATE_LIMITS.requests.limit; i += 1) {
      expect(status(guard, 'read', null).status).toBe(200);
    }
  });

  it('forgets expired windows', () => {
    status(guard, 'upload');
    vi.advanceTimersByTime(61_000);
    status(guard, 'read', 'u2');
    const windows = (guard as unknown as { windows: Map<string, unknown> }).windows;
    expect([...windows.keys()]).toEqual(['requests:u2']);
  });
});
