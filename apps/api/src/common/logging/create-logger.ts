import { ConsoleLogger, type LoggerService } from '@nestjs/common';
import { type AppConfig, LOG_LEVELS } from '../../config/app-config.js';

/** Creates the process logger: JSON lines for log aggregation, or readable output for local work. */
export function createLogger(config: AppConfig, processName: 'api' | 'worker'): LoggerService {
  const minimumLevelIndex = LOG_LEVELS.indexOf(config.log.level);

  return new ConsoleLogger({
    prefix: `DocuMind:${processName}`,
    json: config.log.format === 'json',
    logLevels: LOG_LEVELS.slice(minimumLevelIndex),
  });
}
