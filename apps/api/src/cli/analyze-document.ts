import { type DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { AiProviderError } from '../ai/ai-error.js';
import { runEntrypoint } from '../common/bootstrap/run-entrypoint.js';
import { createLogger } from '../common/logging/create-logger.js';
import { type AppConfig, loadConfig } from '../config/app-config.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import {
  DocumentAnalysisError,
  DocumentAnalysisService,
} from '../extraction/document-analysis.service.js';
import { ExtractionModule } from '../extraction/extraction.module.js';

@Module({})
class AnalyzeDocumentCliModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AnalyzeDocumentCliModule,
      imports: [
        AppConfigModule.forRoot(config),
        DatabaseModule.forRoot('documind-cli'),
        ExtractionModule,
      ],
    };
  }
}

/**
 * Development tool until the worker runs analysis (Phase 9):
 * `npm run analyze -- <documentId>`, after `npm run extract`. Prints the
 * extracted fields for the developer and stores nothing: extractions are
 * saved only for a processing job.
 */
runEntrypoint('analyze-document', async () => {
  const documentId = z.uuid().safeParse(process.argv[2]);
  if (!documentId.success) {
    throw new Error('Usage: npm run analyze -- <documentId>');
  }
  const config = loadConfig(process.env);
  const app = await NestFactory.createApplicationContext(
    AnalyzeDocumentCliModule.register(config),
    { logger: createLogger(config, 'worker') },
  );
  try {
    const analysis = await app.get(DocumentAnalysisService).analyze(documentId.data);
    if (!analysis) {
      process.stderr.write(`No document ${documentId.data}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
  } catch (error) {
    if (error instanceof DocumentAnalysisError) {
      process.stderr.write(`Analysis failed (${error.failure}): ${error.message}\n`);
    } else if (error instanceof AiProviderError) {
      process.stderr.write(
        `Analysis failed (${error.kind}, ${error.retryable ? 'retryable' : 'permanent'}): ${error.message}\n`,
      );
    } else {
      throw error;
    }
    process.exitCode = 1;
  } finally {
    await app.close();
  }
});
