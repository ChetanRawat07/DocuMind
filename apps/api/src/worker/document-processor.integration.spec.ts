import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertDocument, insertUser } from '../../test/support/factories.js';
import {
  classifiedAs,
  field,
  PO_ANSWER,
  PO_TEXT,
  ScriptedProvider,
} from '../../test/support/scripted-ai.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import { AiProviderError } from '../ai/ai-error.js';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import type { AppConfig } from '../config/app-config.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import { DocumentAnalysisService } from '../extraction/document-analysis.service.js';
import { DocumentExtractionsRepository } from '../extraction/document-extractions.repository.js';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository.js';
import { ExtractionReviewsRepository } from '../review/extraction-reviews.repository.js';
import { ReviewService } from '../review/review.service.js';
import { DocumentTextsRepository } from '../text-extraction/document-texts.repository.js';
import { TextExtractionError } from '../text-extraction/text-extraction-error.js';
import type { TextExtractionService } from '../text-extraction/text-extraction.service.js';
import { DocumentProcessor } from './document-processor.js';

const CONFIG = { ai: { timeoutMs: 1000 } } as AppConfig;
const PO_ANSWERS = [classifiedAs('purchase_order', 'PURCHASE ORDER'), PO_ANSWER];
/** The buyer is quoted from a line that is not in the document, so it scores 0.3. */
const UNCERTAIN_PO_ANSWERS = [
  classifiedAs('purchase_order', 'PURCHASE ORDER'),
  {
    ...PO_ANSWER,
    fields: { ...PO_ANSWER.fields, buyerName: field('Globex Ltd', 'Bill to: Globex') },
  },
];

describe('DocumentProcessor', () => {
  let db: DatabaseExecutor;
  let jobs: ProcessingJobsRepository;
  let documents: DocumentsRepository;
  let texts: DocumentTextsRepository;
  let documentId: string;
  let jobId: string;
  let extract: ReturnType<typeof vi.fn<TextExtractionService['extract']>>;

  const processorWith = (provider: ScriptedProvider) => {
    const extractions = new DocumentExtractionsRepository(db);
    return new DocumentProcessor(
      CONFIG,
      db,
      jobs,
      documents,
      texts,
      { extract } as unknown as TextExtractionService,
      new DocumentAnalysisService(
        db,
        documents,
        texts,
        extractions,
        new AuditLogsRepository(db),
        provider,
        // Pages as drawn read exactly like their text layer here; the check is tested with the analysis.
        {
          readRenderedPages: async (id: string, pageNumbers: readonly number[]) =>
            ((await texts.findForDocument(id))?.pages ?? [])
              .filter((page) => pageNumbers.includes(page.pageNumber))
              .map((page) => ({ ...page, method: 'ocr' as const, ocrConfidence: 0.97 })),
        } as unknown as TextExtractionService,
      ),
      new AuditLogsRepository(db),
      new ReviewService(
        db,
        documents,
        extractions,
        new ExtractionReviewsRepository(db),
        new AuditLogsRepository(db),
      ),
    );
  };

  const storeText = (text = PO_TEXT) =>
    texts.replace({
      documentId,
      pages: [{ pageNumber: 1, method: 'text_layer', text, ocrConfidence: null }],
      durationMs: 5,
      engine: 'test',
    });

  const job = () =>
    db.selectFrom('processing_jobs').selectAll().where('id', '=', jobId).executeTakeFirstOrThrow();
  const document = () =>
    db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirstOrThrow();
  const extractionCount = async () =>
    (await db.selectFrom('document_extractions').select('id').execute()).length;
  const auditActions = async () =>
    (await db.selectFrom('audit_logs').select('action').orderBy('id').execute()).map(
      (row) => row.action,
    );

  async function expireLease(): Promise<void> {
    await db
      .updateTable('processing_jobs')
      .set({
        locked_at: sql<Date>`now() - interval '2 hours'`,
        lease_expires_at: sql<Date>`now() - interval '1 hour'`,
      })
      .where('id', '=', jobId)
      .execute();
  }

  beforeAll(() => {
    db = createTestDatabase();
    jobs = new ProcessingJobsRepository(db);
    documents = new DocumentsRepository(db);
    texts = new DocumentTextsRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const owner = await insertUser(db);
    documentId = (await insertDocument(db, owner.id, { status: 'queued' })).id;
    jobId = (await jobs.enqueue(documentId)).job.id;
    extract = vi.fn<TextExtractionService['extract']>();
  });

  it('completes a confident extraction without review', async () => {
    await storeText();
    const processor = processorWith(new ScriptedProvider(...PO_ANSWERS));

    expect(await processor.runNext()).toBe(true);

    expect(await job()).toMatchObject({ status: 'succeeded', attempts: 1, locked_by: null });
    expect(await document()).toMatchObject({
      status: 'completed',
      document_type: 'purchase_order',
    });
    expect((await document()).processed_at).not.toBeNull();
    const extraction = await db
      .selectFrom('document_extractions')
      .select('job_id')
      .executeTakeFirstOrThrow();
    expect(extraction.job_id).toBe(jobId);
    // The text from an earlier attempt is reused rather than extracted again.
    expect(extract).not.toHaveBeenCalled();
    expect(await processor.runNext()).toBe(false);
    expect(
      await db.selectFrom('extraction_reviews').selectAll().executeTakeFirstOrThrow(),
    ).toMatchObject({ decision: 'approved', decided_by: null, fields: {} });
    expect(await auditActions()).toEqual(['document.fields_extracted', 'document.approved']);
  });

  it('sends an extraction with a low-confidence field to review', async () => {
    await storeText();

    await processorWith(new ScriptedProvider(...UNCERTAIN_PO_ANSWERS)).runNext();

    expect(await job()).toMatchObject({ status: 'succeeded' });
    expect((await document()).status).toBe('needs_review');
    expect(await db.selectFrom('extraction_reviews').selectAll().execute()).toEqual([]);
    expect(await auditActions()).toEqual(['document.fields_extracted']);
  });

  it('carries the request that queued the job into its audit entries, and records step durations', async () => {
    await db
      .updateTable('processing_jobs')
      .set({ request_id: 'req-upload' })
      .where('id', '=', jobId)
      .execute();
    extract.mockImplementation(async () => {
      await storeText();
      return { documentId, pageCount: 1, ocrPageCount: 1, characterCount: 1, durationMs: 1234 };
    });

    await processorWith(new ScriptedProvider(...PO_ANSWERS)).runNext();

    const entries = await db
      .selectFrom('audit_logs')
      .select(['action', 'request_id'])
      .orderBy('id')
      .execute();
    expect(entries).toEqual([
      { action: 'document.fields_extracted', request_id: 'req-upload' },
      { action: 'document.approved', request_id: 'req-upload' },
    ]);
    expect(await job()).toMatchObject({ text_extraction_ms: 1234 });
    expect((await job()).ai_ms).toBeGreaterThanOrEqual(0);
  });

  it('records the AI step duration when it fails, keeping the text extraction time', async () => {
    await storeText();
    await db
      .updateTable('processing_jobs')
      .set({ text_extraction_ms: 900 })
      .where('id', '=', jobId)
      .execute();

    await processorWith(
      new ScriptedProvider(new AiProviderError('unavailable', 'scripted', 'down')),
    ).runNext();

    expect(await job()).toMatchObject({ status: 'queued', text_extraction_ms: 900 });
    expect((await job()).ai_ms).not.toBeNull();
  });

  it('extracts the text first when the document has none yet', async () => {
    let statusWhileRunning: string | undefined;
    extract.mockImplementation(async () => {
      statusWhileRunning = (await document()).status;
      await storeText();
      return { documentId, pageCount: 1, ocrPageCount: 0, characterCount: 1, durationMs: 1 };
    });

    await processorWith(new ScriptedProvider(...PO_ANSWERS)).runNext();

    expect(extract).toHaveBeenCalledWith(documentId);
    expect(statusWhileRunning).toBe('processing');
    expect((await job()).status).toBe('succeeded');
  });

  it('fails an unsupported document without retrying', async () => {
    await storeText('Dear Sir, thank you for your letter.');
    const provider = new ScriptedProvider(classifiedAs('other', 'Dear Sir'));

    await processorWith(provider).runNext();

    expect(await job()).toMatchObject({
      status: 'failed',
      last_error_code: 'unsupported_document_type',
    });
    expect((await document()).status).toBe('failed');
    expect(provider.requests).toHaveLength(1);
    expect(await auditActions()).toEqual(['document.processing_failed']);
  });

  it('schedules a retry with backoff after a retryable failure', async () => {
    await storeText();
    const before = Date.now();

    await processorWith(
      new ScriptedProvider(new AiProviderError('unavailable', 'scripted', 'down')),
    ).runNext();

    const retried = await job();
    expect(retried).toMatchObject({
      status: 'queued',
      attempts: 1,
      stage: 'ai_extraction',
      last_error_code: 'ai_unavailable',
      locked_by: null,
    });
    // First retry: 15–30 s later.
    expect(retried.available_at.getTime() - before).toBeGreaterThanOrEqual(15_000);
    expect((await document()).status).toBe('queued');
    expect(await extractionCount()).toBe(0);
    expect(await auditActions()).toEqual([]);
  });

  it('dead-letters a retryable failure on the last attempt', async () => {
    await storeText();
    await db
      .updateTable('processing_jobs')
      .set({ max_attempts: 1 })
      .where('id', '=', jobId)
      .execute();

    await processorWith(
      new ScriptedProvider(new AiProviderError('timeout', 'scripted', 'slow')),
    ).runNext();

    expect(await job()).toMatchObject({ status: 'failed', last_error_code: 'ai_timeout' });
    expect((await document()).status).toBe('failed');
    expect(await auditActions()).toEqual(['document.processing_failed']);
  });

  it('fails a permanent text extraction failure on the first attempt', async () => {
    extract.mockRejectedValue(new TextExtractionError('encrypted_pdf', 'The PDF is encrypted'));

    await processorWith(new ScriptedProvider()).runNext();

    expect(await job()).toMatchObject({
      status: 'failed',
      attempts: 1,
      stage: 'text_extraction',
      last_error_code: 'encrypted_pdf',
    });
  });

  it('retries an unexpected error without storing its message', async () => {
    extract.mockRejectedValue(new Error('connection reset by 10.1.2.3'));

    await processorWith(new ScriptedProvider()).runNext();

    expect(await job()).toMatchObject({
      status: 'queued',
      last_error_code: 'internal_error',
      last_error_message: 'Unexpected error, see the worker log',
    });
  });

  it('saves nothing when its claim was taken over mid-run', async () => {
    extract.mockImplementation(async () => {
      await storeText();
      // Another worker decides this one is dead and takes the job.
      await expireLease();
      await jobs.releaseExpired();
      await jobs.claimNext('worker-b', 60_000);
      return { documentId, pageCount: 1, ocrPageCount: 0, characterCount: 1, durationMs: 1 };
    });

    await processorWith(new ScriptedProvider(...PO_ANSWERS)).runNext();

    expect(await job()).toMatchObject({
      status: 'running',
      locked_by: 'worker-b',
      attempts: 2,
      // The stale worker's timings are fenced out too.
      text_extraction_ms: null,
      ai_ms: null,
    });
    expect(await extractionCount()).toBe(0);
  });

  it('retries the job of a crashed worker once its lease expires', async () => {
    await storeText();
    await jobs.claimNext('crashed-worker', 60_000);
    await expireLease();

    await processorWith(new ScriptedProvider(...PO_ANSWERS)).runNext();

    expect(await job()).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect((await document()).status).toBe('completed');
  });

  it('fails the job of a worker that crashed on its last attempt', async () => {
    await db
      .updateTable('processing_jobs')
      .set({ max_attempts: 1, request_id: 'req-upload' })
      .where('id', '=', jobId)
      .execute();
    await jobs.claimNext('crashed-worker', 60_000);
    await expireLease();

    expect(await processorWith(new ScriptedProvider()).runNext()).toBe(false);

    expect(await job()).toMatchObject({ status: 'failed', last_error_code: 'lease_expired' });
    expect((await document()).status).toBe('failed');
    expect(await auditActions()).toEqual(['document.processing_failed']);
    // Released outside the job's own run, but still traced to the request that queued it.
    expect(
      (await db.selectFrom('audit_logs').select('request_id').executeTakeFirstOrThrow()).request_id,
    ).toBe('req-upload');
  });

  it('stops quietly when the document is deleted while it runs', async () => {
    extract.mockImplementation(async () => {
      await db.deleteFrom('documents').where('id', '=', documentId).execute();
      return null;
    });

    expect(await processorWith(new ScriptedProvider()).runNext()).toBe(true);

    expect(await db.selectFrom('processing_jobs').select('id').execute()).toEqual([]);
  });
});
