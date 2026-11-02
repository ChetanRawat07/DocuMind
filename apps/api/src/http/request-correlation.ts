import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../auth/current-user.decorator.js';
import { withCorrelation } from '../common/correlation/correlation.js';

export const REQUEST_ID_HEADER = 'X-Request-Id';

const logger = new Logger('HTTP');

/**
 * Gives every request a fresh id, returned in `X-Request-Id`, and runs the
 * rest of the request with it, so its logs, audit entries and processing job
 * carry it. Incoming ids are ignored: a client cannot choose or reuse one.
 *
 * Logs one line per request when it ends: method, path without the query
 * string (it can hold search terms), status, duration and user id. Health
 * probes are logged at debug level, as they arrive every few seconds.
 */
export function correlateRequest(request: Request, response: Response, next: NextFunction): void {
  const requestId = randomUUID();
  const started = performance.now();
  response.setHeader(REQUEST_ID_HEADER, requestId);
  // 'close' fires for every request, including one the client abandoned ('finish' does not).
  response.on('close', () => {
    const fields = {
      requestId,
      method: request.method,
      path: request.originalUrl.split('?')[0],
      status: response.statusCode,
      durationMs: Math.round(performance.now() - started),
      userId: (request as AuthenticatedRequest).documindUser?.id ?? null,
      ...(response.writableFinished ? {} : { aborted: true }),
    };
    if (/\/health(\/ready)?$/.test(fields.path ?? '')) {
      logger.debug('Request handled', fields);
    } else {
      logger.log('Request handled', fields);
    }
  });
  withCorrelation({ requestId }, next);
}
