import { NestFactory } from '@nestjs/core';
import { runEntrypoint } from './common/bootstrap/run-entrypoint.js';
import { createLogger } from './common/logging/create-logger.js';
import { loadConfig } from './config/app-config.js';
import { WorkerModule } from './worker/worker.module.js';

/** Background worker process: no HTTP server, only the job poll loop. */
runEntrypoint('worker', async () => {
  const config = loadConfig(process.env);
  const logger = createLogger(config, 'worker');

  const app = await NestFactory.createApplicationContext(WorkerModule.register(config), {
    logger,
  });
  app.enableShutdownHooks();
  logger.log('Worker started', 'Bootstrap');
});
