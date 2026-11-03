import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertDocument, insertJob, insertUser } from '../../test/support/factories.js';
import {
  classifiedAs,
  field,
  PO_ANSWER,
  PO_TEXT,
  ScriptedProvider,
} from '../../test/support/scripted-ai.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import { AiProviderError } from '../ai/ai-error.js';
import type { AiProvider } from '../ai/ai-provider.js';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import { DocumentTextsRepository } from '../text-extraction/document-texts.repository.js';
import type { TextExtractionService } from '../text-extraction/text-extraction.service.js';
import type { ExtractedPage } from '../text-extraction/text-extractor.js';
import {
  DocumentAnalysisError,
  DocumentAnalysisService,
  type ExtractedAnalysis,
} from './document-analysis.service.js';
import { DocumentExtractionsRepository } from './document-extractions.repository.js';
import { MAX_RENDERED_EVIDENCE_PAGES } from './visible-evidence.js';
import { canSkipReview } from '../review/review-fields.js';

describe('DocumentAnalysisService', () => {
  let db: DatabaseExecutor;
  let texts: DocumentTextsRepository;
  let documentId: string;

  /** Rendering reads `drawn` per page, or by default exactly the stored text layer. */
  const renderer = (drawn?: Readonly<Record<number, string>>) => {
    const readRenderedPages = vi.fn(async (id: string, pageNumbers: readonly number[]) => {
      const stored = (await texts.findForDocument(id))?.pages ?? [];
      return pageNumbers.map((pageNumber): ExtractedPage => ({
        pageNumber,
        method: 'ocr',
        text:
          drawn?.[pageNumber] ?? stored.find((page) => page.pageNumber === pageNumber)?.text ?? '',
        ocrConfidence: 0.97,
      }));
    });
    return {
      readRenderedPages,
      service: { readRenderedPages } as unknown as TextExtractionService,
    };
  };

  const serviceWith = (provider: AiProvider, rendering = renderer().service) =>
    new DocumentAnalysisService(
      db,
      new DocumentsRepository(db),
      texts,
      new DocumentExtractionsRepository(db),
      new AuditLogsRepository(db),
      provider,
      rendering,
    );

  const storeText = (
    text: string | readonly string[],
    method: 'text_layer' | 'ocr' = 'text_layer',
  ) =>
    texts.replace({
      documentId,
      pages: (typeof text === 'string' ? [text] : text).map((pageText, index) => ({
        pageNumber: index + 1,
        method,
        text: pageText,
        ocrConfidence: method === 'ocr' ? 0.99 : null,
      })),
      durationMs: 5,
      engine: 'test',
    });

  const analyzeWith = async (rendering: TextExtractionService, answer: unknown = PO_ANSWER) => {
    const analysis = await serviceWith(
      new ScriptedProvider(classifiedAs('purchase_order', 'PURCHASE ORDER'), answer),
      rendering,
    ).analyze(documentId);
    if (analysis?.outcome !== 'extracted') throw new Error('expected an extraction');
    return analysis;
  };

  async function analyzePurchaseOrder(): Promise<ExtractedAnalysis> {
    await storeText(PO_TEXT);
    const analysis = await serviceWith(
      new ScriptedProvider(classifiedAs('purchase_order', 'PURCHASE ORDER'), PO_ANSWER),
    ).analyze(documentId);
    if (analysis?.outcome !== 'extracted') throw new Error('expected an extraction');
    return analysis;
  }

  beforeAll(() => {
    db = createTestDatabase();
    texts = new DocumentTextsRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const owner = await insertUser(db);
    documentId = (await insertDocument(db, owner.id)).id;
  });

  describe('analyze', () => {
    it('classifies, extracts with the matching schema, and scores the fields', async () => {
      await storeText(PO_TEXT);
      const provider = new ScriptedProvider(
        classifiedAs('purchase_order', 'PURCHASE ORDER'),
        PO_ANSWER,
      );

      const analysis = await serviceWith(provider).analyze(documentId);

      expect(analysis).toMatchObject({
        outcome: 'extracted',
        documentId,
        documentType: 'purchase_order',
        schemaVersion: 1,
        classificationConfidence: 0.95,
        classificationPrompt: 'document.classify@1',
        extractionPrompt: 'document.extract.purchase_order@1',
        aiProvider: 'scripted',
        aiModel: 'scripted-model',
        issues: [],
        overallConfidence: 0.95,
      });
      const [classify, extract] = provider.requests;
      expect(classify?.user).toContain('<untrusted_document>\nPURCHASE ORDER');
      expect(extract?.user).toContain('- poNumber: Purchase order number');
      expect(extract?.user).toContain('<untrusted_document>\nPURCHASE ORDER');
      expect(extract?.jsonSchema).toMatchObject({ required: ['fields', 'lineItems'] });
    });

    describe('evidence a reader can see', () => {
      it('confirms text-layer evidence on the rendered page before completing without review', async () => {
        await storeText(PO_TEXT);
        const { service, readRenderedPages } = renderer();

        const analysis = await analyzeWith(service);

        expect(readRenderedPages).toHaveBeenCalledWith(documentId, [1]);
        expect(analysis.issues).toEqual([]);
        expect(canSkipReview(analysis)).toBe(true);
      });

      it('flags values whose evidence is only in hidden text, keeping the values', async () => {
        await storeText(PO_TEXT);
        // As drawn, the page shows a different total than its text layer.
        const drawn = PO_TEXT.replace('Total: 100.00 USD', 'Total: 1,200.00 USD');

        const analysis = await analyzeWith(renderer({ 1: drawn }).service);

        expect(analysis.issues).toEqual([
          { code: 'evidence_not_visible', fields: ['currency', 'totalAmount'] },
        ]);
        expect(analysis.fields.totalAmount?.value).toBe(100);
        expect(canSkipReview(analysis)).toBe(false);
      });

      it('renders only text-layer pages that hold evidence, trusting OCR pages as read', async () => {
        const [heading = '', ...rest] = PO_TEXT.split('\n');
        await texts.replace({
          documentId,
          pages: [
            {
              pageNumber: 1,
              method: 'ocr',
              text: [heading, ...rest.slice(0, 4)].join('\n'),
              ocrConfidence: 0.99,
            },
            {
              pageNumber: 2,
              method: 'text_layer',
              text: 'Terms and conditions',
              ocrConfidence: null,
            },
            {
              pageNumber: 3,
              method: 'text_layer',
              text: rest.slice(4).join('\n'),
              ocrConfidence: null,
            },
          ],
          durationMs: 5,
          engine: 'test',
        });
        const { service, readRenderedPages } = renderer();

        expect((await analyzeWith(service)).issues).toEqual([]);
        expect(readRenderedPages).toHaveBeenCalledWith(documentId, [3]);
      });

      it('renders nothing when every page was read with OCR', async () => {
        await storeText(PO_TEXT, 'ocr');
        const { service, readRenderedPages } = renderer();

        await analyzeWith(service);

        expect(readRenderedPages).not.toHaveBeenCalled();
      });

      it('renders nothing for an extraction that goes to review anyway', async () => {
        await storeText(PO_TEXT);
        const { service, readRenderedPages } = renderer();
        const answer = {
          ...PO_ANSWER,
          fields: { ...PO_ANSWER.fields, buyerName: field('Initech', 'Buyer: Initech') },
        };

        await analyzeWith(service, answer);

        expect(readRenderedPages).not.toHaveBeenCalled();
      });

      it(`sends evidence spread over more than ${String(MAX_RENDERED_EVIDENCE_PAGES)} pages to review without rendering`, async () => {
        const lines = PO_TEXT.split('\n');
        await storeText(
          [lines.slice(0, 2), lines.slice(2, 3), lines.slice(3, 4), lines.slice(4)].map((page) =>
            page.join('\n'),
          ),
        );
        const { service, readRenderedPages } = renderer();

        const analysis = await analyzeWith(service);

        expect(readRenderedPages).not.toHaveBeenCalled();
        expect(analysis.issues).toEqual([
          {
            code: 'evidence_not_visible',
            fields: [
              'poNumber',
              'buyerName',
              'supplierName',
              'orderDate',
              'currency',
              'totalAmount',
              'lineItems',
            ],
          },
        ]);
      });

      it('sends the document to review when the pages cannot be rendered', async () => {
        await storeText(PO_TEXT);
        const failing = {
          readRenderedPages: vi.fn().mockRejectedValue(new Error('storage unavailable')),
        } as unknown as TextExtractionService;

        const analysis = await analyzeWith(failing);

        expect(analysis.issues[0]?.code).toBe('evidence_not_visible');
        expect(canSkipReview(analysis)).toBe(false);
      });
    });

    it('stops after classification for an unsupported document', async () => {
      await storeText('Dear Sir, thank you for your letter.');
      const provider = new ScriptedProvider(classifiedAs('other', 'Dear Sir'));

      const analysis = await serviceWith(provider).analyze(documentId);

      expect(analysis).toMatchObject({ outcome: 'unsupported', classificationConfidence: 0.95 });
      expect(provider.requests).toHaveLength(1);
    });

    it('trusts a classification less when its evidence is not in the document', async () => {
      await storeText(PO_TEXT);
      const provider = new ScriptedProvider(
        classifiedAs('purchase_order', 'ORDER FORM'),
        PO_ANSWER,
      );

      const analysis = await serviceWith(provider).analyze(documentId);

      expect(analysis).toMatchObject({ classificationConfidence: 0.5, overallConfidence: 0.5 });
    });

    it('flags text longer than the extraction limit as truncated', async () => {
      await storeText(`${PO_TEXT}\n${'Terms and conditions apply. '.repeat(700)}`);
      const provider = new ScriptedProvider(
        classifiedAs('purchase_order', 'PURCHASE ORDER'),
        PO_ANSWER,
      );

      const analysis = await serviceWith(provider).analyze(documentId);

      expect(analysis).toMatchObject({ overallConfidence: 0.5 });
      expect((analysis as ExtractedAnalysis).issues).toContainEqual({
        code: 'text_truncated',
        fields: [],
      });
    });

    it('rejects a schema-violating answer as invalid output, so it can never be saved', async () => {
      await storeText(PO_TEXT);
      const provider = new ScriptedProvider(classifiedAs('purchase_order', 'PURCHASE ORDER'), {
        ...PO_ANSWER,
        fields: { ...PO_ANSWER.fields, totalAmount: field('one hundred', 'Total: 100.00 USD') },
      });

      await expect(serviceWith(provider).analyze(documentId)).rejects.toMatchObject({
        constructor: AiProviderError,
        kind: 'invalid_output',
      });
    });

    it('returns null for an unknown document', async () => {
      expect(await serviceWith(new ScriptedProvider()).analyze(crypto.randomUUID())).toBeNull();
    });

    it('refuses a document without extracted text (retryable) or with no text at all (permanent)', async () => {
      const service = serviceWith(new ScriptedProvider());
      await expect(service.analyze(documentId)).rejects.toMatchObject({
        constructor: DocumentAnalysisError,
        failure: 'text_not_extracted',
        permanent: false,
      });

      await storeText('   ');
      await expect(service.analyze(documentId)).rejects.toMatchObject({
        failure: 'no_text',
        permanent: true,
      });
    });
  });

  describe('save', () => {
    it('stores the extraction, records the document type and audits without values', async () => {
      const analysis = await analyzePurchaseOrder();
      const { id: jobId } = await insertJob(db, documentId, 'succeeded');

      const result = await serviceWith(new ScriptedProvider()).save(jobId, analysis);

      expect(result?.created).toBe(true);
      expect(result?.extraction).toMatchObject({
        jobId,
        documentType: 'purchase_order',
        overallConfidence: 0.95,
        classificationConfidence: 0.95,
        validationIssues: [],
        extractionPrompt: 'document.extract.purchase_order@1',
      });
      expect(result?.extraction.fields.poNumber).toEqual({
        value: 'PO-7781',
        confidence: 0.95,
        evidence: 'PO Number: PO-7781',
      });
      const document = await db
        .selectFrom('documents')
        .select('document_type')
        .where('id', '=', documentId)
        .executeTakeFirstOrThrow();
      expect(document.document_type).toBe('purchase_order');
      const audit = await db.selectFrom('audit_logs').selectAll().execute();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: 'document.fields_extracted', actor_type: 'system' });
      expect(JSON.stringify(audit[0]?.metadata)).not.toMatch(/PO-7781|Globex|Acme/);
    });

    it('returns the stored extraction when a job saves twice, without a second audit entry', async () => {
      const analysis = await analyzePurchaseOrder();
      const { id: jobId } = await insertJob(db, documentId, 'succeeded');
      const service = serviceWith(new ScriptedProvider());
      const first = await service.save(jobId, analysis);

      const retry = await service.save(jobId, { ...analysis, overallConfidence: 0.1 });

      expect(retry).toMatchObject({ created: false, extraction: { id: first?.extraction.id } });
      expect(retry?.extraction.overallConfidence).toBe(0.95);
      expect(await db.selectFrom('audit_logs').selectAll().execute()).toHaveLength(1);
    });

    it('returns null when the document was deleted while it was analyzed', async () => {
      const analysis = await analyzePurchaseOrder();
      const { id: jobId } = await insertJob(db, documentId, 'succeeded');
      await db.deleteFrom('documents').where('id', '=', documentId).execute();

      expect(await serviceWith(new ScriptedProvider()).save(jobId, analysis)).toBeNull();
      expect(await db.selectFrom('document_extractions').selectAll().execute()).toEqual([]);
    });
  });
});
