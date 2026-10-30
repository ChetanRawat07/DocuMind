import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import type { ExtractedPage, TextMethod } from './text-extractor.js';

export interface DocumentText {
  readonly documentId: string;
  readonly pageCount: number;
  readonly ocrPageCount: number;
  readonly characterCount: number;
  readonly durationMs: number;
  /** Library versions that produced the text, so results can be traced and reproduced. */
  readonly engine: string;
  readonly extractedAt: Date;
  readonly pages: readonly ExtractedPage[];
}

export interface NewDocumentText {
  readonly documentId: string;
  readonly pages: readonly ExtractedPage[];
  readonly durationMs: number;
  readonly engine: string;
}

/**
 * Extracted text, keyed by document. Reads are not owner-scoped: callers are
 * the worker and the text pipeline, which act on a document id they were
 * given; an HTTP endpoint exposing this text must check ownership first.
 */
@Injectable()
export class DocumentTextsRepository {
  constructor(@Inject(DATABASE) private readonly db: DatabaseExecutor) {}

  /**
   * Stores a document's text, replacing any earlier extraction, so running
   * extraction again is safe. Run it in a transaction (pass `executor`): the
   * delete and inserts must land together.
   */
  async replace(text: NewDocumentText, executor = this.db): Promise<void> {
    await executor
      .deleteFrom('document_texts')
      .where('document_id', '=', text.documentId)
      .execute();
    await executor
      .insertInto('document_texts')
      .values({
        document_id: text.documentId,
        page_count: text.pages.length,
        ocr_page_count: text.pages.filter((page) => page.method === 'ocr').length,
        character_count: text.pages.reduce((total, page) => total + page.text.length, 0),
        duration_ms: Math.round(text.durationMs),
        engine: text.engine,
      })
      .execute();
    await executor
      .insertInto('document_text_pages')
      .values(
        text.pages.map((page) => ({
          document_id: text.documentId,
          page_number: page.pageNumber,
          method: page.method,
          text: page.text,
          ocr_confidence: page.ocrConfidence,
        })),
      )
      .execute();
  }

  async findForDocument(documentId: string, executor = this.db): Promise<DocumentText | null> {
    const summary = await executor
      .selectFrom('document_texts')
      .selectAll()
      .where('document_id', '=', documentId)
      .executeTakeFirst();
    if (!summary) return null;
    const pages = await executor
      .selectFrom('document_text_pages')
      .selectAll()
      .where('document_id', '=', documentId)
      .orderBy('page_number')
      .execute();
    return {
      documentId,
      pageCount: summary.page_count,
      ocrPageCount: summary.ocr_page_count,
      characterCount: summary.character_count,
      durationMs: summary.duration_ms,
      engine: summary.engine,
      extractedAt: summary.extracted_at,
      pages: pages.map((page) => ({
        pageNumber: page.page_number,
        // The CHECK constraint guarantees one of the two methods.
        method: page.method as TextMethod,
        text: page.text,
        ocrConfidence: page.ocr_confidence,
      })),
    };
  }
}
