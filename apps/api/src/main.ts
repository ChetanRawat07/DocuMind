import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { runEntrypoint } from './common/bootstrap/run-entrypoint.js';
import { createLogger } from './common/logging/create-logger.js';
import { loadConfig } from './config/app-config.js';
import { configureHttpApp } from './http/configure-http-app.js';

/** HTTP API process: serves REST requests and never runs long document processing inline. */
runEntrypoint('api', async () => {
  const config = loadConfig(process.env);
  const logger = createLogger(config, 'api');

  const app = await NestFactory.create(AppModule.register(config), { logger });
  configureHttpApp(app, config);

  await app.listen(config.http.port);
  logger.log(`HTTP API listening on port ${config.http.port}`, 'Bootstrap');
});
