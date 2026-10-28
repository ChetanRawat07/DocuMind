import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { ApiErrorResponse } from '@documind/shared';

const GENERIC_SERVER_ERROR_MESSAGE = 'An unexpected error occurred.';

/**
 * Converts every exception into the shared `ApiErrorResponse` envelope.
 * 4xx messages are passed through because they describe the client's mistake;
 * 5xx details are logged server-side only so internals never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const clientError = toClientError(exception);
    const status = clientError?.status ?? statusOf(exception);

    if (!clientError) {
      this.logger.error(
        exception instanceof Error ? exception.message : 'Non-error value thrown',
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ApiErrorResponse = {
      error: {
        code: errorCodeFor(status),
        message: clientError?.message ?? GENERIC_SERVER_ERROR_MESSAGE,
      },
    };

    const { httpAdapter } = this.httpAdapterHost;
    httpAdapter.reply(host.switchToHttp().getResponse(), body, status);
  }
}

function errorCodeFor(status: number): string {
  // HttpStatus is a numeric enum, so the reverse lookup yields names such as NOT_FOUND.
  const name = (HttpStatus as Record<number, string | undefined>)[status];
  return name ?? 'HTTP_ERROR';
}

function statusOf(exception: unknown): number {
  return exception instanceof HttpException
    ? exception.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

/** Returns status and message when the exception is a 4xx that is safe to describe to the client. */
function toClientError(exception: unknown): { status: number; message: string } | null {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return status < 500 ? { status, message: httpExceptionMessage(exception) } : null;
  }
  if (isExposedHttpError(exception)) {
    return { status: exception.status, message: exception.message };
  }
  return null;
}

/**
 * Errors following the `http-errors` convention (used by Express body parsing,
 * e.g. 413 for an oversized body) mark client-safe 4xx errors with `expose: true`.
 */
function isExposedHttpError(exception: unknown): exception is Error & { status: number } {
  if (!(exception instanceof Error)) return false;
  const { status, expose } = exception as { status?: unknown; expose?: unknown };
  return expose === true && typeof status === 'number' && status >= 400 && status < 500;
}

function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }

  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.filter((part) => typeof part === 'string').join('; ');
  }
  return exception.message;
}
