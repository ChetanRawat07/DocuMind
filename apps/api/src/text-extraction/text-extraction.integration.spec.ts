import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertDocument, insertUser } from '../../test/support/factories.js';
import { expectPgError, PG } from '../../test/support/postgres-errors.js';
import { samplePdf, textImage } from '../../test/support/sample-documents.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import { FilesystemStorage } from '../storage/filesystem-storage.js';
import { ObjectNotFoundError } from '../storage/object-storage.js';
import { DocumentTextsRepository } from './document-texts.repository.js';
import { OcrEngine } from './ocr-engine.js';
import { TextExtractionError } from './text-extraction-error.js';
import { TEXT_ENGINE, TextExtractionService } from './text-extraction.service.js';

const OCR_TIMEOUT = 60_000;

describe('text extraction (database and storage)', () => {
  let db: DatabaseExecutor;
  let storageRoot: string;
  let storage: FilesystemStorage;
  let texts: DocumentTextsRepository;
  let documents: DocumentsRepository;
  let service: TextExtractionService;
  let ownerId: string;

  /** A document row plus its stored file, as an upload would leave them. */
  async function storedDocument(
    content: Buffer,
    mimeType: 'application/pdf' | 'image/png' = 'application/pdf',
  ) {
    const { id } = await insertDocument(db, ownerId, { mimeType });
    const document = await documents.findByIdForProcessing(id);
    if (!document) throw new Error('document not inserted');
    await storage.put(document.storageKey, content);
    return document;
  }

  async function auditActions() {
    const rows = await db
      .selectFrom('audit_logs')
      .select(['action', 'actor_type', 'metadata'])
      .execute();
    return rows;
  }

  beforeAll(async () => {
    db = createTestDatabase();
    storageRoot = await mkdtemp(join(tmpdir(), 'documind-text-test-'));
    storage = new FilesystemStorage(storageRoot);
    texts = new DocumentTextsRepository(db);
    documents = new DocumentsRepository(db);
    service = new TextExtractionService(db, documents, texts, new AuditLogsRepository(db), storage);
  });

  afterAll(async () => {
    await db.destroy();
    await rm(storageRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    ownerId = (await insertUser(db)).id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('TextExtractionService', () => {
    it('stores the text of each page with a summary and a system audit entry', async () => {
      const document = await storedDocument(
        samplePdf([
          { lines: ['INVOICE 1023', 'Bill to: ACME Corporation'] },
          { lines: ['Payment due within thirty days.'] },
        ]),
      );

      const summary = await service.extract(document.id);

      expect(summary).toMatchObject({ documentId: document.id, pageCount: 2, ocrPageCount: 0 });
      const stored = await texts.findForDocument(document.id);
      expect(stored).toMatchObject({
        pageCount: 2,
        ocrPageCount: 0,
        characterCount: summary?.characterCount,
        engine: TEXT_ENGINE,
      });
      expect(stored?.pages.map((page) => page.text)).toEqual([
        'INVOICE 1023\nBill to: ACME Corporation',
        'Payment due within thirty days.',
      ]);
      expect(await auditActions()).toEqual([
        {
          action: 'document.text_extracted',
          actor_type: 'system',
          // Counts only, never the text.
          metadata: {
            pageCount: 2,
            ocrPageCount: 0,
            characterCount: summary?.characterCount,
            durationMs: summary?.durationMs,
          },
        },
      ]);
    });

    it(
      'stores OCR pages with their confidence',
      async () => {
        const document = await storedDocument(
          textImage(['RECEIPT 55', 'Total 19.99']),
          'image/png',
        );

        await service.extract(document.id);

        const stored = await texts.findForDocument(document.id);
        expect(stored).toMatchObject({ pageCount: 1, ocrPageCount: 1 });
        expect(stored?.pages[0]?.method).toBe('ocr');
        expect(stored?.pages[0]?.text).toContain('RECEIPT 55');
        expect(stored?.pages[0]?.ocrConfidence).toBeGreaterThan(0.8);
      },
      OCR_TIMEOUT,
    );

    it('replaces an earlier extraction when run again', async () => {
      const document = await storedDocument(
        samplePdf([
          { lines: ['First version of the text.'] },
          { lines: ['Page two of the first version.'] },
        ]),
      );
      await service.extract(document.id);
      await storage.put(
        document.storageKey,
        samplePdf([{ lines: ['Second version of the text.'] }]),
      );

      await service.extract(document.id);

      const stored = await texts.findForDocument(document.id);
      expect(stored?.pageCount).toBe(1);
      expect(stored?.pages.map((page) => page.text)).toEqual(['Second version of the text.']);
    });

    it('returns null for a document that does not exist', async () => {
      expect(await service.extract('00000000-0000-4000-8000-000000000000')).toBeNull();
    });

    it('stores nothing and returns null when the document is deleted during extraction', async () => {
      const document = await storedDocument(samplePdf([{ lines: ['Deleted while being read.'] }]));
      const replace = texts.replace.bind(texts);
      vi.spyOn(texts, 'replace').mockImplementation(async (text, executor) => {
        await db.deleteFrom('documents').where('id', '=', document.id).execute();
        return replace(text, executor);
      });

      expect(await service.extract(document.id)).toBeNull();
      expect(await db.selectFrom('document_texts').selectAll().execute()).toEqual([]);
      expect(await auditActions()).toEqual([]);
    });

    it('lets a missing stored file surface as ObjectNotFoundError', async () => {
      const { id } = await insertDocument(db, ownerId);

      await expect(service.extract(id)).rejects.toBeInstanceOf(ObjectNotFoundError);
    });

    it('releases the OCR engine whether extraction succeeds or fails', async () => {
      const terminate = vi.spyOn(OcrEngine.prototype, 'terminate');
      const good = await storedDocument(
        samplePdf([{ lines: ['Enough typed text on this page.'] }]),
      );
      const bad = await storedDocument(Buffer.from('%PDF-1.7 corrupt'));

      await service.extract(good.id);
      await expect(service.extract(bad.id)).rejects.toBeInstanceOf(TextExtractionError);

      expect(terminate).toHaveBeenCalledTimes(2);
    });

    it('stores nothing for a file that cannot be read', async () => {
      const document = await storedDocument(samplePdf([{ lines: ['x'] }], { encrypted: true }));

      await expect(service.extract(document.id)).rejects.toMatchObject({
        constructor: TextExtractionError,
        failure: 'encrypted_pdf',
      });
      expect(await texts.findForDocument(document.id)).toBeNull();
      expect(await auditActions()).toEqual([]);
    });
  });

  describe('DocumentTextsRepository and schema', () => {
    const page = {
      pageNumber: 1,
      method: 'text_layer' as const,
      text: 'Hello',
      ocrConfidence: null,
    };

    it('deletes a document’s text with the document', async () => {
      const { id } = await insertDocument(db, ownerId);
      await texts.replace({ documentId: id, pages: [page], durationMs: 5, engine: 'test' });

      await db.deleteFrom('documents').where('id', '=', id).execute();

      expect(await db.selectFrom('document_texts').selectAll().execute()).toEqual([]);
      expect(await db.selectFrom('document_text_pages').selectAll().execute()).toEqual([]);
    });

    it.each([
      ['an OCR page without a confidence', { method: 'ocr' as const, ocrConfidence: null }],
      [
        'a text-layer page with a confidence',
        { method: 'text_layer' as const, ocrConfidence: 0.9 },
      ],
      ['a confidence above 1', { method: 'ocr' as const, ocrConfidence: 1.5 }],
    ])('rejects %s', async (_case, overrides) => {
      const { id } = await insertDocument(db, ownerId);

      await expectPgError(
        texts.replace({
          documentId: id,
          pages: [{ ...page, ...overrides }],
          durationMs: 5,
          engine: 'test',
        }),
        { code: PG.checkViolation },
      );
    });

    it('rejects more OCR pages than pages', async () => {
      const { id } = await insertDocument(db, ownerId);

      await expectPgError(
        db
          .insertInto('document_texts')
          .values({
            document_id: id,
            page_count: 1,
            ocr_page_count: 2,
            character_count: 0,
            duration_ms: 0,
            engine: 'test',
          })
          .execute(),
        { code: PG.checkViolation },
      );
    });
  });
});
