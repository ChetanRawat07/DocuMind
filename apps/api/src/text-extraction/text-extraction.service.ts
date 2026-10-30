import { performance } from 'node:perf_hooks';
import { buffer } from 'node:stream/consumers';
import { Inject, Injectable } from '@nestjs/common';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import { ObjectStorage } from '../storage/object-storage.js';
import { DocumentTextsRepository } from './document-texts.repository.js';
import { OCR_ENGINE_NAME, OcrEngine } from './ocr-engine.js';
import { pdfjsVersion } from './pdf-document.js';
import { extractText } from './text-extractor.js';

export const TEXT_ENGINE = `pdf.js ${pdfjsVersion}; ${OCR_ENGINE_NAME}`;

/** PostgreSQL foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

export interface TextExtractionSummary {
  readonly documentId: string;
  readonly pageCount: number;
  readonly ocrPageCount: number;
  readonly characterCount: number;
  readonly durationMs: number;
}

/**
 * Extracts a stored document's text and saves it. This is the processing
 * step Phase 9's worker runs for a job; for now it is started by hand with
 * `npm run extract -- <documentId>`.
 *
 * Throws TextExtractionError when the file cannot be read (see `permanent`
 * for whether a retry can help). Returns null when the document no longer
 * exists, including when it is deleted while extraction runs: its text is
 * then not stored, since the foreign key rejects it.
 */
@Injectable()
export class TextExtractionService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseExecutor,
    private readonly documents: DocumentsRepository,
    private readonly texts: DocumentTextsRepository,
    private readonly auditLogs: AuditLogsRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async extract(documentId: string): Promise<TextExtractionSummary | null> {
    const document = await this.documents.findByIdForProcessing(documentId);
    if (!document) return null;

    const started = performance.now();
    // Bounded by the upload size limit (10 MiB).
    const content = await buffer((await this.storage.get(document.storageKey)).body);
    const ocr = new OcrEngine();
    let pages;
    try {
      pages = await extractText(content, document.mimeType, ocr);
    } finally {
      await ocr.terminate();
    }
    const durationMs = Math.round(performance.now() - started);
    const summary: TextExtractionSummary = {
      documentId,
      pageCount: pages.length,
      ocrPageCount: pages.filter((page) => page.method === 'ocr').length,
      characterCount: pages.reduce((total, page) => total + page.text.length, 0),
      durationMs,
    };

    try {
      await this.db.transaction().execute(async (trx) => {
        await this.texts.replace({ documentId, pages, durationMs, engine: TEXT_ENGINE }, trx);
        await this.auditLogs.append(
          {
            actor: { type: 'system' },
            action: 'document.text_extracted',
            resourceType: 'document',
            resourceId: documentId,
            requestId: null,
            // Counts only: audit entries never hold document content.
            metadata: {
              pageCount: summary.pageCount,
              ocrPageCount: summary.ocrPageCount,
              characterCount: summary.characterCount,
              durationMs,
            },
          },
          trx,
        );
      });
    } catch (error) {
      if ((error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION) return null;
      throw error;
    }
    return summary;
  }
}
