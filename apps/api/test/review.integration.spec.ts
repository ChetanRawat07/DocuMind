import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  apiErrorResponseSchema,
  documentExtractionSchema,
  documentSchema,
  processingJobSchema,
} from '@documind/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { JWT_KEY_RESOLVER } from '../src/auth/access-token-verifier.js';
import { loadConfig } from '../src/config/app-config.js';
import type { DatabaseExecutor } from '../src/database/database.types.js';
import { configureHttpApp } from '../src/http/configure-http-app.js';
import { insertDocument, insertJob, insertUser } from './support/factories.js';
import { TEST_SUPABASE_URL, TestTokenIssuer } from './support/test-auth.js';
import {
  createTestDatabase,
  resolveTestDatabase,
  truncateAllTables,
} from './support/test-database.js';

const stored = (value: unknown, confidence: number | null, evidence: string | null = null) => ({
  value,
  confidence,
  evidence,
});

/** A purchase order with four flagged fields: buyerName, supplierName, totalAmount, lineItems. */
const FIELDS = {
  poNumber: stored('PO-7781', 0.95, 'PO Number: PO-7781'),
  buyerName: stored('Globex Ltd', 0.3, 'Bill to: Globex'),
  supplierName: stored(null, null),
  orderDate: stored('2026-10-01', 0.95, 'Order date: 2026-10-01'),
  deliveryDate: stored(null, null),
  currency: stored('USD', 0.95, 'Total: 100.00 USD'),
  totalAmount: stored(100, 0.5, 'Total: 100.00 USD'),
  lineItems: stored([{ description: 'Widget A', quantity: 4, unitPrice: 20, amount: 80 }], 0.5),
};
const ISSUES = [
  { code: 'evidence_not_found', fields: ['buyerName'] },
  { code: 'missing_required_field', fields: ['supplierName'] },
  { code: 'line_items_total_mismatch', fields: ['lineItems', 'totalAmount'] },
];
const FLAGGED = ['buyerName', 'supplierName', 'totalAmount', 'lineItems'];

describe('extraction review (HTTP)', () => {
  let app: INestApplication<Server>;
  let db: DatabaseExecutor;
  let issuer: TestTokenIssuer;
  let storageRoot: string;
  let aliceId: string;
  let alice: string;
  let bob: string;
  let documentId: string;
  let extractionId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const base = () => `/api/v1/documents/${documentId}/extraction`;

  const getExtraction = async (token = alice) =>
    documentExtractionSchema.parse((await http().get(base()).set(bearer(token)).expect(200)).body);
  const reviewField = (field: string, body: object, token = alice) =>
    http()
      .put(`${base()}/fields/${field}`)
      .set(bearer(token))
      .send({ extractionId, ...body });
  const approve = (token = alice) =>
    http().post(`${base()}/approve`).set(bearer(token)).send({ extractionId });
  const reject = (body: object = {}, token = alice) =>
    http()
      .post(`${base()}/reject`)
      .set(bearer(token))
      .send({ extractionId, ...body });
  const errorMessage = (response: request.Response) =>
    JSON.stringify(apiErrorResponseSchema.parse(response.body).error.message);

  const document = () =>
    db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirstOrThrow();
  const reviewRow = () =>
    db
      .selectFrom('extraction_reviews')
      .selectAll()
      .where('extraction_id', '=', extractionId)
      .executeTakeFirst();
  const auditEntries = () =>
    db
      .selectFrom('audit_logs')
      .select(['action', 'actor_user_id', 'metadata'])
      .where('action', '!=', 'user.registered')
      .orderBy('id')
      .execute();

  async function insertExtraction(forDocument: string): Promise<string> {
    const job = await insertJob(db, forDocument, 'succeeded');
    const row = await db
      .insertInto('document_extractions')
      .values({
        document_id: forDocument,
        job_id: job.id,
        document_type: 'purchase_order',
        schema_version: 1,
        fields: JSON.stringify(FIELDS),
        overall_confidence: 0,
        classification_confidence: 0.95,
        validation_issues: JSON.stringify(ISSUES),
        ai_provider: 'test',
        ai_model: 'test-model',
        classification_prompt: 'document.classify@1',
        extraction_prompt: 'document.extract.purchase_order@1',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function confirmFlagged(): Promise<void> {
    for (const field of FLAGGED) {
      await reviewField(field, { action: 'confirm' }).expect(200);
    }
  }

  beforeAll(async () => {
    issuer = await TestTokenIssuer.create();
    db = createTestDatabase();
    storageRoot = await mkdtemp(join(tmpdir(), 'documind-review-test-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: resolveTestDatabase().url,
      SUPABASE_URL: TEST_SUPABASE_URL,
      STORAGE_DRIVER: 'filesystem',
      STORAGE_FILESYSTEM_ROOT: storageRoot,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(config)],
    })
      .overrideProvider(JWT_KEY_RESOLVER)
      .useValue(issuer.keyResolver)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>({ logger: false });
    configureHttpApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
    await rm(storageRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    aliceId = randomUUID();
    await insertUser(db, { id: aliceId, email: 'alice@example.test' });
    alice = await issuer.sign(aliceId, { claims: { email: 'alice@example.test' } });
    bob = await issuer.sign(randomUUID(), { claims: { email: 'bob@example.test' } });
    documentId = (
      await insertDocument(db, aliceId, {
        status: 'needs_review',
        documentType: 'purchase_order',
      })
    ).id;
    extractionId = await insertExtraction(documentId);
  });

  describe('reading', () => {
    it('returns the latest extraction with the fields that need a check', async () => {
      const extraction = await getExtraction();

      expect(extraction).toMatchObject({
        id: extractionId,
        documentType: 'purchase_order',
        review: { decision: null, decidedBy: null },
      });
      expect(extraction.fields.filter((field) => field.needsReview).map((f) => f.name)).toEqual(
        FLAGGED,
      );
      expect(extraction.fields.find((field) => field.name === 'buyerName')).toMatchObject({
        value: 'Globex Ltd',
        evidence: 'Bill to: Globex',
        issues: ['evidence_not_found'],
        reviewed: false,
      });
    });

    it('answers 404 for a document without an extraction', async () => {
      documentId = (await insertDocument(db, aliceId, { status: 'queued' })).id;

      const response = await http().get(base()).set(bearer(alice)).expect(404);
      expect(errorMessage(response)).toContain('no extracted data');
    });

    it("answers another user's document with the same 404 as a missing one", async () => {
      const response = await http().get(base()).set(bearer(bob)).expect(404);
      expect(errorMessage(response)).toContain('Document not found');
      await http()
        .get(`/api/v1/documents/${randomUUID()}/extraction`)
        .set(bearer(alice))
        .expect(404);
    });

    it('requires authentication', async () => {
      await http().get(base()).expect(401);
      await http().post(`${base()}/approve`).send({ extractionId }).expect(401);
    });
  });

  describe('field review', () => {
    it('confirms a field as it is', async () => {
      const response = await reviewField('buyerName', { action: 'confirm' }).expect(200);

      const field = documentExtractionSchema
        .parse(response.body)
        .fields.find((candidate) => candidate.name === 'buyerName');
      expect(field).toMatchObject({ value: 'Globex Ltd', reviewed: true, corrected: false });
    });

    it('corrects a field, keeping the model value and its score', async () => {
      await reviewField('totalAmount', { action: 'correct', value: 80 }).expect(200);

      const field = (await getExtraction()).fields.find((f) => f.name === 'totalAmount');
      expect(field).toMatchObject({
        value: 80,
        extractedValue: 100,
        confidence: 0.5,
        reviewed: true,
        corrected: true,
      });
      // The model's output itself is never changed.
      const original = await db
        .selectFrom('document_extractions')
        .select('fields')
        .executeTakeFirstOrThrow();
      expect(original.fields).toEqual(FIELDS);
    });

    it('keeps earlier fields when another one is reviewed, and the last value of each', async () => {
      await reviewField('totalAmount', { action: 'correct', value: 90 }).expect(200);
      await reviewField('supplierName', { action: 'correct', value: 'Acme GmbH' }).expect(200);
      await reviewField('totalAmount', { action: 'correct', value: 80 }).expect(200);

      expect((await reviewRow())?.fields).toEqual({
        totalAmount: { value: 80 },
        supplierName: { value: 'Acme GmbH' },
      });
    });

    it('confirms the corrected value, not the model value', async () => {
      await reviewField('totalAmount', { action: 'correct', value: 80 }).expect(200);
      await reviewField('totalAmount', { action: 'confirm' }).expect(200);

      expect((await reviewRow())?.fields).toEqual({ totalAmount: { value: 80 } });
    });

    it('audits the field and the action, never the value', async () => {
      await reviewField('supplierName', { action: 'correct', value: 'Acme GmbH' }).expect(200);
      await reviewField('buyerName', { action: 'confirm' }).expect(200);

      expect(await auditEntries()).toEqual([
        {
          action: 'document.field_reviewed',
          actor_user_id: aliceId,
          metadata: { extractionId, field: 'supplierName', action: 'corrected' },
        },
        {
          action: 'document.field_reviewed',
          actor_user_id: aliceId,
          metadata: { extractionId, field: 'buyerName', action: 'confirmed' },
        },
      ]);
    });

    it.each([
      ['orderDate', '01/10/2026'],
      ['totalAmount', '100'],
      ['currency', 'usd'],
    ])('rejects an invalid %s value with 400', async (field, value) => {
      const response = await reviewField(field, { action: 'correct', value }).expect(400);

      expect(errorMessage(response)).toContain(field);
      expect(await reviewRow()).toBeUndefined();
    });

    it('lets a list be confirmed but not corrected', async () => {
      await reviewField('lineItems', { action: 'correct', value: 'x' }).expect(400);
      await reviewField('lineItems', { action: 'confirm' }).expect(200);
    });

    it('answers 404 for a field the document type does not have', async () => {
      await reviewField('invoiceNumber', { action: 'confirm' }).expect(404);
      await reviewField('__proto__', { action: 'confirm' }).expect(404);
    });

    it('validates the request body', async () => {
      await http()
        .put(`${base()}/fields/buyerName`)
        .set(bearer(alice))
        .send({ action: 'confirm' })
        .expect(400);
      await reviewField('buyerName', { action: 'delete' }).expect(400);
    });

    it("cannot review another user's document", async () => {
      await reviewField('buyerName', { action: 'confirm' }, bob).expect(404);
      expect(await reviewRow()).toBeUndefined();
    });
  });

  describe('decisions', () => {
    it('refuses approval while a flagged field is unchecked', async () => {
      await reviewField('buyerName', { action: 'confirm' }).expect(200);

      const response = await approve().expect(409);

      expect(errorMessage(response)).toContain('supplierName, totalAmount, lineItems');
      expect((await document()).status).toBe('needs_review');
    });

    it('approves once every flagged field is checked, and finalizes the document', async () => {
      await confirmFlagged();
      await reviewField('totalAmount', { action: 'correct', value: 80 }).expect(200);

      const response = await approve().expect(200);

      expect(documentSchema.parse(response.body)).toMatchObject({ status: 'completed' });
      expect(await reviewRow()).toMatchObject({ decision: 'approved', decided_by: aliceId });
      const extraction = await getExtraction();
      expect(extraction.review).toMatchObject({ decision: 'approved', decidedBy: 'user' });
      expect(extraction.fields.find((f) => f.name === 'totalAmount')?.value).toBe(80);
      expect((await auditEntries()).at(-1)).toEqual({
        action: 'document.approved',
        actor_user_id: aliceId,
        metadata: { extractionId, correctedFields: ['totalAmount'] },
      });
    });

    it('allows no changes after the decision', async () => {
      await confirmFlagged();
      await approve().expect(200);

      await reviewField('poNumber', { action: 'correct', value: 'PO-1' }).expect(409);
      await approve().expect(409);
      await reject().expect(409);
    });

    it('rejects with a reason kept out of the audit log, and allows reprocessing', async () => {
      const response = await reject({ reason: '  Wrong document type  ' }).expect(200);

      expect(documentSchema.parse(response.body)).toMatchObject({ status: 'rejected' });
      expect((await document()).processed_at).not.toBeNull();
      expect(await reviewRow()).toMatchObject({
        decision: 'rejected',
        decided_by: aliceId,
        reject_reason: 'Wrong document type',
      });
      expect((await auditEntries()).at(-1)).toEqual({
        action: 'document.rejected',
        actor_user_id: aliceId,
        metadata: { extractionId, hasReason: true },
      });
      expect((await getExtraction()).review.rejectReason).toBe('Wrong document type');

      const job = await http()
        .post(`/api/v1/documents/${documentId}/jobs`)
        .set(bearer(alice))
        .expect(202);
      expect(processingJobSchema.parse(job.body).status).toBe('queued');
      expect((await document()).status).toBe('queued');
    });

    it('treats a blank reason as none', async () => {
      await reject({ reason: '   ' }).expect(200);

      expect((await reviewRow())?.reject_reason).toBeNull();
    });

    it('refuses a reason over 500 characters', async () => {
      await reject({ reason: 'x'.repeat(501) }).expect(400);
    });

    it('refuses actions on an extraction that is no longer the latest', async () => {
      await http().get(base()).set(bearer(alice)).expect(200);
      const stale = extractionId;
      extractionId = await insertExtraction(documentId);

      await http()
        .post(`${base()}/approve`)
        .set(bearer(alice))
        .send({ extractionId: stale })
        .expect(409);
      await http()
        .put(`${base()}/fields/buyerName`)
        .set(bearer(alice))
        .send({ extractionId: stale, action: 'confirm' })
        .expect(409);
    });

    it('refuses review of a document that is not waiting for it', async () => {
      await db
        .updateTable('documents')
        .set({ status: 'failed' })
        .where('id', '=', documentId)
        .execute();

      await reviewField('buyerName', { action: 'confirm' }).expect(409);
      await reject().expect(409);
    });

    it('records exactly one decision when approve and reject race', async () => {
      await confirmFlagged();

      const statuses = (await Promise.all([approve(), reject(), approve(), reject()])).map(
        (response) => response.status,
      );

      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(3);
      const decisions = (await auditEntries()).filter((entry) =>
        ['document.approved', 'document.rejected'].includes(entry.action),
      );
      expect(decisions).toHaveLength(1);
    });

    it('waits for a concurrent change to the same document', async () => {
      await confirmFlagged();
      let settled = false;
      let pending: Promise<request.Response> | undefined;

      await db.transaction().execute(async (trx) => {
        await trx
          .selectFrom('documents')
          .select('id')
          .where('id', '=', documentId)
          .forUpdate()
          .execute();
        pending = approve().then((response) => {
          settled = true;
          return response;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(settled).toBe(false);
        // Changed while the approval waits: it must see the new state, not the one it started with.
        await trx
          .updateTable('documents')
          .set({ status: 'failed' })
          .where('id', '=', documentId)
          .execute();
      });

      expect((await pending)?.status).toBe(409);
      expect((await document()).status).toBe('failed');
      expect(await reviewRow()).toMatchObject({ decision: null });
    });

    it("cannot decide on another user's document", async () => {
      await confirmFlagged();

      await approve(bob).expect(404);
      await reject({}, bob).expect(404);
      expect((await document()).status).toBe('needs_review');
    });
  });
});
