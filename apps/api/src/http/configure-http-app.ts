import { type INestApplication, NotFoundException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import type { AppConfig } from '../config/app-config.js';

export const API_PREFIX = 'api/v1';

/**
 * Applies HTTP cross-cutting concerns. Shared by main.ts and the e2e tests so
 * tests exercise the same security headers, CORS policy and error format as
 * the running server.
 */
export function configureHttpApp(app: INestApplication, config: AppConfig): void {
  app.use(helmet());
  app.enableCors({
    // An empty list disables cross-origin access entirely, which is the safe default.
    origin: [...config.http.corsAllowedOrigins],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.use(rejectOutsideApiPrefix);
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  app.enableShutdownHooks();
}

/**
 * Nest only mounts its 404 handler under the global prefix, so unknown paths
 * outside it would get Express's default HTML page. Every route lives under
 * the prefix, so anything else is answered as a 404 in the standard error format.
 */
function rejectOutsideApiPrefix(request: Request, _response: Response, next: NextFunction): void {
  const prefix = `/${API_PREFIX}`;
  const isUnderPrefix = request.path === prefix || request.path.startsWith(`${prefix}/`);
  next(
    isUnderPrefix ? undefined : new NotFoundException(`Cannot ${request.method} ${request.path}`),
  );
}
