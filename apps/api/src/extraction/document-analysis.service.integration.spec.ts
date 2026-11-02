import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertDocument, insertJob, insertUser } from '../../test/support/factories.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import { AiProviderError } from '../ai/ai-error.js';
import { AiProvider, type AiRequest, type AiResponse } from '../ai/ai-provider.js';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import { DocumentTextsRepository } from '../text-extraction/document-texts.repository.js';
import {
  DocumentAnalysisError,
  DocumentAnalysisService,
  type ExtractedAnalysis,
} from './document-analysis.service.js';
import { DocumentExtractionsRepository } from './document-extractions.repository.js';

const PO_TEXT = [
  'PURCHASE ORDER',
  'PO Number: PO-7781',
  'Buyer: Globex Ltd',
  'Supplier: Acme GmbH',
  'Order date: 2026-10-01',
  'Widget A  4 x 25.00  100.00',
  'Total: 100.00 USD',
].join('\n');

const field = (value: string | number | null, evidence: string | null) => ({ value, evidence });
const PO_ANSWER = {
  fields: {
    poNumber: field('PO-7781', 'PO Number: PO-7781'),
    buyerName: field('Globex Ltd', 'Buyer: Globex Ltd'),
    supplierName: field('Acme GmbH', 'Supplier: Acme GmbH'),
    orderDate: field('2026-10-01', 'Order date: 2026-10-01'),
    deliveryDate: field(null, null),
    currency: field('USD', 'Total: 100.00 USD'),
    totalAmount: field(100, 'Total: 100.00 USD'),
  },
  lineItems: [{ description: 'Widget A', quantity: 4, unitPrice: 25, amount: 100 }],
};

/** Answers each call with the next scripted text and records the requests. */
class ScriptedProvider extends AiProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-model';
  readonly requests: AiRequest[] = [];
  private readonly answers: string[];

  constructor(...answers: unknown[]) {
    super();
    this.answers = answers.map((answer) =>
      typeof answer === 'string' ? answer : JSON.stringify(answer),
    );
  }

  generate(request: AiRequest): Promise<AiResponse> {
    this.requests.push(request);
    const text = this.answers.shift();
    if (text === undefined) throw new Error('Unexpected AI call');
    return Promise.resolve({
      text,
      provider: this.name,
      model: this.model,
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
    });
  }
}

describe('DocumentAnalysisService', () => {
  let db: DatabaseExecutor;
  let texts: DocumentTextsRepository;
  let documentId: string;

  const serviceWith = (provider: AiProvider) =>
    new DocumentAnalysisService(
      db,
      new DocumentsRepository(db),
      texts,
      new DocumentExtractionsRepository(db),
      new AuditLogsRepository(db),
      provider,
    );

  const storeText = (text: string) =>
    texts.replace({
      documentId,
      pages: [{ pageNumber: 1, method: 'text_layer', text, ocrConfidence: null }],
      durationMs: 5,
      engine: 'test',
    });

  const classifiedAs = (documentType: string, evidence: string | null) => ({
    documentType,
    evidence,
  });

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
