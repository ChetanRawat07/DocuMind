import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyticsSchema, type DocumentStatus, type DocumentType } from '@documind/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'kysely';
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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** `YYYY-MM-DD` of an instant in a timezone. */
const localDate = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);

describe('analytics (HTTP)', () => {
  let app: INestApplication<Server>;
  let db: DatabaseExecutor;
  let issuer: TestTokenIssuer;
  let storageRoot: string;
  let aliceId: string;
  let alice: string;
  let bobId: string;

  const http = () => request(app.getHttpServer());
  const analytics = async (query = '') => {
    const response = await http()
      .get(`/api/v1/analytics${query}`)
      .set({ Authorization: `Bearer ${alice}` })
      .expect(200);
    return analyticsSchema.parse(response.body);
  };

  /**
   * A processed document of `ownerId`, with an extraction and review when
   * given, and a succeeded job of `processingSeconds`.
   */
  async function processed(
    ownerId: string,
    document: {
      status: DocumentStatus;
      type?: DocumentType | null;
      processedAt?: Date;
      createdAt?: Date;
      confidence?: number;
      extractedFields?: Record<string, unknown>;
      review?: {
        decision: 'approved' | 'rejected';
        by: 'user' | 'system';
        fields?: Record<string, unknown>;
      };
      processingSeconds?: number;
    },
  ): Promise<string> {
    const processedAt = document.processedAt ?? new Date();
    const { id } = await insertDocument(db, ownerId, {
      status: document.status,
      documentType: document.type ?? null,
      createdAt: document.createdAt ?? processedAt,
    });
    await db
      .updateTable('documents')
      .set({ processed_at: processedAt })
      .where('id', '=', id)
      .execute();
    const job = await insertJob(db, id, 'succeeded');
    await db
      .updateTable('processing_jobs')
      .set({
        started_at: new Date(processedAt.getTime() - (document.processingSeconds ?? 1) * 1000),
        finished_at: processedAt,
        // A failed document's job failed; its time is not a processing time.
        ...(document.status === 'failed'
          ? { status: 'failed', last_error_code: 'ocr_failed' }
          : {}),
      })
      .where('id', '=', job.id)
      .execute();
    if (document.confidence !== undefined) {
      const extraction = await db
        .insertInto('document_extractions')
        .values({
          document_id: id,
          job_id: job.id,
          document_type: document.type ?? 'invoice',
          schema_version: 1,
          fields: JSON.stringify(document.extractedFields ?? {}),
          overall_confidence: document.confidence,
          classification_confidence: 0.95,
          validation_issues: JSON.stringify([]),
          ai_provider: 'test',
          ai_model: 'test',
          classification_prompt: 'test@1',
          extraction_prompt: 'test@1',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (document.review) {
        await db
          .insertInto('extraction_reviews')
          .values({
            extraction_id: extraction.id,
            fields: JSON.stringify(document.review.fields ?? {}),
            decision: document.review.decision,
            decided_by: document.review.by === 'user' ? ownerId : null,
            decided_at: new Date(),
          })
          .execute();
      }
    }
    return id;
  }

  beforeAll(async () => {
    issuer = await TestTokenIssuer.create();
    db = createTestDatabase();
    storageRoot = await mkdtemp(join(tmpdir(), 'documind-analytics-test-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: resolveTestDatabase().url,
      SUPABASE_URL: TEST_SUPABASE_URL,
      STORAGE_DRIVER: 'filesystem',
      STORAGE_FILESYSTEM_ROOT: storageRoot,
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config)] })
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
    bobId = randomUUID();
    await insertUser(db, { id: aliceId });
    await insertUser(db, { id: bobId });
    alice = await issuer.sign(aliceId);
  });

  it("computes every metric over the user's documents processed in the window", async () => {
    const now = new Date();
    await processed(aliceId, {
      status: 'completed',
      type: 'invoice',
      confidence: 0.95,
      review: { decision: 'approved', by: 'system' },
      processingSeconds: 10,
    });
    await processed(aliceId, {
      status: 'completed',
      type: 'purchase_order',
      processedAt: new Date(now.getTime() - DAY),
      confidence: 0.72,
      extractedFields: {
        totalAmount: { value: 100, confidence: 0.72, evidence: null },
        buyerName: { value: 'Globex', confidence: 0.3, evidence: null },
      },
      // One value confirmed (100.0 is the same number), one corrected.
      review: {
        decision: 'approved',
        by: 'user',
        fields: { totalAmount: { value: 100.0 }, buyerName: { value: 'Globex Ltd' } },
      },
      processingSeconds: 30,
    });
    // JSON.stringify writes 100.0 as 100; store the reviewer's 100.0 as jsonb itself.
    await db
      .updateTable('extraction_reviews')
      .set({
        fields: sql`'{"totalAmount": {"value": 100.0}, "buyerName": {"value": "Globex Ltd"}}'::jsonb`,
      })
      .where('decided_by', '=', aliceId)
      .execute();
    await processed(aliceId, { status: 'needs_review', type: 'invoice', confidence: 0.4 });
    await processed(aliceId, {
      status: 'rejected',
      type: 'contract',
      confidence: 0.6,
      extractedFields: { title: { value: 'Lease', confidence: 0.6, evidence: null } },
      // Reviewed values of a rejected extraction are not corrections of approved data.
      review: { decision: 'rejected', by: 'user', fields: { title: { value: 'Rental lease' } } },
    });
    // Failed after an earlier extraction: that stale extraction must not be scored.
    await processed(aliceId, { status: 'failed', confidence: 0.2 });
    // Still waiting from before the window: "needs review" means waiting now.
    await processed(aliceId, {
      status: 'needs_review',
      type: 'invoice',
      processedAt: new Date(now.getTime() - 10 * DAY),
      confidence: 0.5,
    });
    // Outside the 7-day window.
    await processed(aliceId, {
      status: 'completed',
      type: 'invoice',
      processedAt: new Date(now.getTime() - 10 * DAY),
      confidence: 0.95,
    });
    // Uploaded, not processed yet.
    await insertDocument(db, aliceId, { status: 'queued' });
    // Another user's document never counts.
    await processed(bobId, { status: 'needs_review', type: 'invoice', confidence: 0.1 });

    const result = await analytics('?days=7&tz=UTC');

    expect(result).toMatchObject({
      days: 7,
      timezone: 'UTC',
      since: localDate(new Date(now.getTime() - 6 * DAY), 'UTC'),
      documents: { uploaded: 6, processed: 5, succeeded: 4, failed: 1, needsReview: 2 },
      successRate: 0.8,
      failureRate: 0.2,
      // Succeeded jobs of 10, 30, 1 and 1 seconds; the failed document's job is left out.
      processingMs: { average: 10_500, p95: 27_000 },
      review: {
        extracted: 4,
        autoCompleted: 1,
        approvedAfterReview: 1,
        rejected: 1,
        pending: 1,
        rate: 0.75,
      },
      corrections: { reviewedFields: 2, correctedFields: 1, rate: 0.5 },
    });
    expect(result.documentTypes).toEqual([
      { type: 'invoice', count: 2 },
      { type: 'contract', count: 1 },
      { type: 'purchase_order', count: 1 },
      { type: 'unclassified', count: 1 },
    ]);
    expect(result.confidence).toEqual([
      { bucket: 'below_50', count: 1 },
      { bucket: '50_to_70', count: 1 },
      { bucket: '70_to_90', count: 1 },
      { bucket: '90_and_above', count: 1 },
    ]);
    expect(result.volume).toHaveLength(7);
    expect(result.volume.at(-1)).toEqual({
      date: localDate(now, 'UTC'),
      processed: 4,
      failed: 1,
    });
    expect(result.volume.at(-2)).toEqual({
      date: localDate(new Date(now.getTime() - DAY), 'UTC'),
      processed: 1,
      failed: 0,
    });
  });

  it('reports an empty period as zeros and null rates, with every day present', async () => {
    const result = await analytics('?days=30');

    expect(result).toMatchObject({
      days: 30,
      documents: { uploaded: 0, processed: 0, failed: 0, needsReview: 0 },
      successRate: null,
      failureRate: null,
      processingMs: { average: null, p95: null },
      documentTypes: [],
      review: { extracted: 0, rate: null },
      corrections: { reviewedFields: 0, rate: null },
    });
    expect(result.volume).toHaveLength(30);
    expect(result.volume.every((day) => day.processed === 0)).toBe(true);
    expect(result.confidence.map((bucket) => bucket.count)).toEqual([0, 0, 0, 0]);
  });

  it("scores only each document's latest extraction", async () => {
    const id = await processed(aliceId, {
      status: 'needs_review',
      type: 'invoice',
      confidence: 0.95,
    });
    const job = await insertJob(db, id, 'succeeded');
    await db
      .insertInto('document_extractions')
      .values({
        document_id: id,
        job_id: job.id,
        document_type: 'invoice',
        schema_version: 1,
        fields: JSON.stringify({}),
        overall_confidence: 0.3,
        classification_confidence: 0.95,
        validation_issues: JSON.stringify([]),
        ai_provider: 'test',
        ai_model: 'test',
        classification_prompt: 'test@1',
        extraction_prompt: 'test@1',
        created_at: sql<Date>`now() + interval '1 second'`,
      })
      .execute();

    const result = await analytics();

    expect(result.confidence.find((bucket) => bucket.count > 0)).toEqual({
      bucket: 'below_50',
      count: 1,
    });
    expect(result.review.extracted).toBe(1);
  });

  it("groups days in the viewer's timezone", async () => {
    // 20:00 UTC two days ago is already 01:30 the next day in India.
    const todayUtc = new Date(`${localDate(new Date(), 'UTC')}T00:00:00.000Z`);
    const instant = new Date(todayUtc.getTime() - 2 * DAY + 20 * HOUR);
    await processed(aliceId, { status: 'failed', processedAt: instant });

    const utc = await analytics('?days=7&tz=UTC');
    const india = await analytics('?days=7&tz=Asia/Kolkata');

    const dayOf = (result: typeof utc) => result.volume.find((day) => day.processed > 0)?.date;
    expect(dayOf(utc)).toBe(localDate(instant, 'UTC'));
    expect(dayOf(india)).toBe(localDate(instant, 'Asia/Kolkata'));
    expect(dayOf(utc)).not.toBe(dayOf(india));
    expect(india.volume.at(-1)?.date).toBe(localDate(new Date(), 'Asia/Kolkata'));
  });

  it('starts the window at local midnight', async () => {
    const start = new Date(`${localDate(new Date(Date.now() - 6 * DAY), 'UTC')}T00:00:00.000Z`);
    await processed(aliceId, { status: 'failed', processedAt: new Date(start.getTime() + 1000) });
    await processed(aliceId, { status: 'failed', processedAt: new Date(start.getTime() - 1000) });

    const result = await analytics('?days=7&tz=UTC');

    expect(result.documents.processed).toBe(1);
    expect(result.volume[0]).toMatchObject({ date: localDate(start, 'UTC'), processed: 1 });
  });

  it('validates the query and requires authentication', async () => {
    const bearer = { Authorization: `Bearer ${alice}` };
    await http().get('/api/v1/analytics?days=14').set(bearer).expect(400);
    await http().get('/api/v1/analytics?tz=Mars/Olympus').set(bearer).expect(400);
    // Known to Node's ICU data but not to PostgreSQL: still a 400, not a 500.
    await http().get('/api/v1/analytics?tz=US/Pacific-New').set(bearer).expect(400);
    await http().get('/api/v1/analytics').expect(401);
  });
});
