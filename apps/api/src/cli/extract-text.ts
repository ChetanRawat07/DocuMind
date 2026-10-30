import { type DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { runEntrypoint } from '../common/bootstrap/run-entrypoint.js';
import { createLogger } from '../common/logging/create-logger.js';
import { type AppConfig, loadConfig } from '../config/app-config.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { TextExtractionError } from '../text-extraction/text-extraction-error.js';
import { TextExtractionModule } from '../text-extraction/text-extraction.module.js';
import { TextExtractionService } from '../text-extraction/text-extraction.service.js';

@Module({})
class ExtractTextCliModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: ExtractTextCliModule,
      imports: [
        AppConfigModule.forRoot(config),
        DatabaseModule.forRoot('documind-cli'),
        TextExtractionModule,
      ],
    };
  }
}

/**
 * Development tool until the worker runs extraction (Phase 9):
 * `npm run extract -- <documentId>`. Prints counts, never the text itself.
 */
runEntrypoint('extract-text', async () => {
  const documentId = z.uuid().safeParse(process.argv[2]);
  if (!documentId.success) {
    throw new Error('Usage: npm run extract -- <documentId>');
  }
  const config = loadConfig(process.env);
  const app = await NestFactory.createApplicationContext(ExtractTextCliModule.register(config), {
    logger: createLogger(config, 'worker'),
  });
  try {
    const summary = await app.get(TextExtractionService).extract(documentId.data);
    if (!summary) {
      process.stderr.write(`No document ${documentId.data}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    if (!(error instanceof TextExtractionError)) throw error;
    process.stderr.write(
      `Extraction failed (${error.failure}, ${error.permanent ? 'permanent' : 'retryable'}): ${error.message}\n`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
});
