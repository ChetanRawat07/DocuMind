import { ConsoleLogger, type LoggerService, type LogLevel } from '@nestjs/common';
import { type AppConfig, LOG_LEVELS } from '../../config/app-config.js';
import { currentCorrelation } from '../correlation/correlation.js';

/**
 * Keys masked wherever they appear in logged objects. Defense in depth: code
 * must not log these at all. String messages are printed as they are.
 */
export const REDACTED_LOG_KEYS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'apiKey',
  'secret',
];

/**
 * Adds the current request and job ids to every line, so a request can be
 * followed through the API, its job, the worker and the AI calls.
 * Explicit fields passed by the caller win over the context.
 */
export class CorrelatedLogger extends ConsoleLogger {
  protected override printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, unknown>,
  ): void {
    const fields = { ...currentCorrelation(), ...params };
    super.printMessages(
      messages,
      context,
      logLevel,
      writeStreamType,
      errorStack,
      Object.keys(fields).length > 0 ? fields : undefined,
    );
  }
}

/**
 * Creates the process logger: one JSON object per line for log aggregation,
 * or readable output for local work. Structured fields passed after the
 * message (`logger.log('Job succeeded', { jobId, durationMs })`) become
 * top-level JSON keys.
 */
export function createLogger(config: AppConfig, processName: 'api' | 'worker'): LoggerService {
  const minimumLevelIndex = LOG_LEVELS.indexOf(config.log.level);

  return new CorrelatedLogger({
    prefix: `DocuMind:${processName}`,
    json: config.log.format === 'json',
    flattenParams: true,
    redact: REDACTED_LOG_KEYS,
    logLevels: LOG_LEVELS.slice(minimumLevelIndex),
  });
}
