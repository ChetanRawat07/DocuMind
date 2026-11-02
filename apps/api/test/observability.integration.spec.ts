import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditLogListResponseSchema,
  documentActivityResponseSchema,
  documentSchema,
  ownedProcessingJobListResponseSchema,
  processingJobSchema,
  processingSummarySchema,
} from '@documind/shared';
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
import { insertDocument, insertUser } from './support/factories.js';
import { TEST_SUPABASE_URL, TestTokenIssuer } from './support/test-auth.js';
import {
  createTestDatabase,
  resolveTestDatabase,
  truncateAllTables,
} from './support/test-database.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('observability (HTTP)', () => {
  let app: INestApplication<Server>;
  let db: DatabaseExecutor;
  let issuer: TestTokenIssuer;
  let storageRoot: string;
  let aliceId: string;
  let alice: string;
  let bobId: string;
  let bob: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const requestIdOf = (response: request.Response) => response.headers['x-request-id'] as string;

  /** A finished job of `documentId`, with timings. */
  async function insertFinishedJob(
    documentId: string,
    job: {
      status: 'succeeded' | 'failed';
      processingSeconds: number;
      textExtractionMs?: number;
      aiMs?: number;
      errorCode?: string;
      finishedDaysAgo?: number;
    },
  ): Promise<void> {
    const finishedAt = sql<Date>`now() - make_interval(days => ${job.finishedDaysAgo ?? 0})`;
    await db
      .insertInto('processing_jobs')
      .values({
        document_id: documentId,
        status: job.status,
        attempts: 1,
        started_at: sql<Date>`${finishedAt} - make_interval(secs => ${job.processingSeconds})`,
        finished_at: finishedAt,
        text_extraction_ms: job.textExtractionMs ?? null,
        ai_ms: job.aiMs ?? null,
        last_error_code: job.errorCode ?? null,
      })
      .execute();
  }

  beforeAll(async () => {
    issuer = await TestTokenIssuer.create();
    db = createTestDatabase();
    storageRoot = await mkdtemp(join(tmpdir(), 'documind-observability-test-'));
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
    bobId = randomUUID();
    await insertUser(db, { id: aliceId, email: 'alice@example.test' });
    await insertUser(db, { id: bobId, email: 'bob@example.test' });
    alice = await issuer.sign(aliceId, { claims: { email: 'alice@example.test' } });
    bob = await issuer.sign(bobId, { claims: { email: 'bob@example.test' } });
  });

  describe('request ids', () => {
    it('gives every response its own id and ignores one sent by the client', async () => {
      const first = await http().get('/api/v1/health').set('X-Request-Id', 'chosen').expect(200);
      const second = await http().get('/api/v1/nowhere').expect(404);

      expect(requestIdOf(first)).toMatch(UUID);
      expect(requestIdOf(second)).toMatch(UUID);
      expect(requestIdOf(first)).not.toBe(requestIdOf(second));
    });

    it('follows an upload into its audit entry and its processing job', async () => {
      const response = await http()
        .post('/api/v1/documents')
        .set(bearer(alice))
        .attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
        .expect(201);
      const { id } = documentSchema.parse(response.body);

      const audit = await db
        .selectFrom('audit_logs')
        .select('request_id')
        .where('action', '=', 'document.uploaded')
        .executeTakeFirstOrThrow();
      const job = await db
        .selectFrom('processing_jobs')
        .select('request_id')
        .where('document_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(audit.request_id).toBe(requestIdOf(response));
      expect(job.request_id).toBe(requestIdOf(response));
    });

    it('is returned with the jobs it queued', async () => {
      const { id } = await insertDocument(db, aliceId, { status: 'failed' });

      const response = await http()
        .post(`/api/v1/documents/${id}/jobs`)
        .set(bearer(alice))
        .expect(202);

      expect(processingJobSchema.parse(response.body).requestId).toBe(requestIdOf(response));
    });
  });

  describe('GET /processing/summary', () => {
    it("counts the user's queue and recent outcomes, with durations", async () => {
      const { id: queued } = await insertDocument(db, aliceId, { status: 'queued' });
      await db.insertInto('processing_jobs').values({ document_id: queued }).execute();
      const { id: done } = await insertDocument(db, aliceId, { status: 'needs_review' });
      await insertFinishedJob(done, {
        status: 'succeeded',
        processingSeconds: 10,
        textExtractionMs: 2000,
        aiMs: 6000,
      });
      await insertFinishedJob(done, {
        status: 'succeeded',
        processingSeconds: 30,
        textExtractionMs: 4000,
        aiMs: 20_000,
      });
      await insertFinishedJob(done, {
        status: 'failed',
        processingSeconds: 5,
        errorCode: 'ai_timeout',
      });
      await insertFinishedJob(done, {
        status: 'failed',
        processingSeconds: 5,
        errorCode: 'ai_timeout',
      });
      await insertFinishedJob(done, {
        status: 'failed',
        processingSeconds: 5,
        errorCode: 'encrypted_pdf',
      });
      // Outside the 7-day window.
      await insertFinishedJob(done, {
        status: 'failed',
        processingSeconds: 5,
        errorCode: 'old_failure',
        finishedDaysAgo: 8,
      });
      // Bob's jobs never count for Alice.
      const { id: bobs } = await insertDocument(db, bobId, { status: 'queued' });
      await db.insertInto('processing_jobs').values({ document_id: bobs }).execute();

      const response = await http()
        .get('/api/v1/processing/summary')
        .set(bearer(alice))
        .expect(200);

      const summary = processingSummarySchema.parse(response.body);
      expect(summary).toMatchObject({
        windowDays: 7,
        queued: 1,
        running: 0,
        succeeded: 2,
        failed: 3,
        failuresByCode: [
          { code: 'ai_timeout', count: 2 },
          { code: 'encrypted_pdf', count: 1 },
        ],
        processingMs: { average: 20_000 },
        textExtractionMs: { average: 3000 },
        aiMs: { average: 13_000 },
      });
      expect(summary.processingMs.p95).toBe(29_000);
      expect(summary.oldestQueuedAt).not.toBeNull();
    });

    it('reports empty durations as null', async () => {
      const response = await http().get('/api/v1/processing/summary').set(bearer(bob)).expect(200);

      expect(processingSummarySchema.parse(response.body)).toMatchObject({
        queued: 0,
        oldestQueuedAt: null,
        failuresByCode: [],
        processingMs: { average: null, p95: null },
      });
    });
  });

  describe('GET /processing/jobs', () => {
    it("lists the user's jobs across documents, newest first, filtered by status", async () => {
      const { id: first } = await insertDocument(db, aliceId, {
        status: 'failed',
        originalFilename: 'first.pdf',
      });
      await insertFinishedJob(first, {
        status: 'failed',
        processingSeconds: 1,
        errorCode: 'ocr_failed',
      });
      const { id: second } = await insertDocument(db, aliceId, {
        status: 'queued',
        originalFilename: 'second.pdf',
      });
      await db.insertInto('processing_jobs').values({ document_id: second }).execute();
      const { id: bobs } = await insertDocument(db, bobId, { status: 'queued' });
      await db.insertInto('processing_jobs').values({ document_id: bobs }).execute();

      const all = ownedProcessingJobListResponseSchema.parse(
        (await http().get('/api/v1/processing/jobs').set(bearer(alice)).expect(200)).body,
      );
      const failed = ownedProcessingJobListResponseSchema.parse(
        (await http().get('/api/v1/processing/jobs?status=failed').set(bearer(alice)).expect(200))
          .body,
      );

      expect(all.items.map((job) => job.document.originalFilename)).toEqual([
        'second.pdf',
        'first.pdf',
      ]);
      expect(failed.items).toHaveLength(1);
      expect(failed.items[0]).toMatchObject({
        errorCode: 'ocr_failed',
        document: { id: first, originalFilename: 'first.pdf' },
      });
    });

    it('validates the query', async () => {
      await http().get('/api/v1/processing/jobs?status=done').set(bearer(alice)).expect(400);
      await http().get('/api/v1/processing/jobs?limit=101').set(bearer(alice)).expect(400);
      await http().get('/api/v1/processing/jobs').expect(401);
    });
  });

  describe('audit log', () => {
    async function auditPage(token: string, query = '') {
      const response = await http()
        .get(`/api/v1/audit-logs${query}`)
        .set(bearer(token))
        .expect(200);
      return auditLogListResponseSchema.parse(response.body);
    }

    it("shows the user's actions and the system's actions on their documents, never others'", async () => {
      const upload = await http()
        .post('/api/v1/documents')
        .set(bearer(alice))
        .attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
        .expect(201);
      const { id } = documentSchema.parse(upload.body);
      await db
        .insertInto('audit_logs')
        .values([
          {
            actor_type: 'system',
            action: 'document.text_extracted',
            resource_type: 'document',
            resource_id: id,
            metadata: JSON.stringify({ pageCount: 1 }),
          },
          {
            actor_type: 'user',
            actor_user_id: bobId,
            action: 'document.uploaded',
            resource_type: 'document',
            resource_id: randomUUID(),
          },
        ])
        .execute();

      const page = await auditPage(alice);

      expect(page.items.map((entry) => [entry.actor, entry.action])).toEqual([
        ['system', 'document.text_extracted'],
        ['user', 'document.uploaded'],
      ]);
      expect(page.items[1]).toMatchObject({
        resourceId: id,
        requestId: requestIdOf(upload),
        metadata: { mimeType: 'application/pdf' },
      });
      expect(page.nextCursor).toBeNull();
      expect((await auditPage(bob)).items.map((entry) => entry.action)).toEqual([
        'document.uploaded',
      ]);
    });

    it('pages with a cursor, without gaps, repeats or an empty last page', async () => {
      await db
        .insertInto('audit_logs')
        .values(
          Array.from({ length: 4 }, (_, index) => ({
            actor_type: 'user',
            actor_user_id: aliceId,
            action: 'document.viewed',
            resource_type: 'document',
            resource_id: randomUUID(),
            metadata: JSON.stringify({ index }),
          })),
        )
        .execute();

      const first = await auditPage(alice, '?limit=2');
      const second = await auditPage(alice, `?limit=2&cursor=${first.nextCursor ?? ''}`);

      expect([...first.items, ...second.items].map((entry) => entry.metadata.index)).toEqual([
        3, 2, 1, 0,
      ]);
      // The last page is exactly full: no cursor to an empty page.
      expect(second.nextCursor).toBeNull();
    });

    it('keeps the user’s own entries about a deleted document', async () => {
      const { id } = await insertDocument(db, aliceId);
      await db
        .insertInto('audit_logs')
        .values([
          {
            actor_type: 'user',
            actor_user_id: aliceId,
            action: 'document.deleted',
            resource_type: 'document',
            resource_id: id,
          },
          {
            actor_type: 'system',
            action: 'document.text_extracted',
            resource_type: 'document',
            resource_id: id,
          },
        ])
        .execute();
      await db.deleteFrom('documents').where('id', '=', id).execute();

      expect((await auditPage(alice)).items.map((entry) => entry.action)).toEqual([
        'document.deleted',
      ]);
    });

    it('validates the query', async () => {
      await http().get('/api/v1/audit-logs?cursor=abc').set(bearer(alice)).expect(400);
      await http().get('/api/v1/audit-logs?limit=0').set(bearer(alice)).expect(400);
      await http().get('/api/v1/audit-logs').expect(401);
    });

    it("lists a document's activity, with the same 404 for another user's document", async () => {
      const { id } = await insertDocument(db, aliceId);
      await db
        .insertInto('audit_logs')
        .values({
          actor_type: 'system',
          action: 'document.text_extracted',
          resource_type: 'document',
          resource_id: id,
        })
        .execute();

      const response = await http()
        .get(`/api/v1/documents/${id}/activity`)
        .set(bearer(alice))
        .expect(200);

      expect(documentActivityResponseSchema.parse(response.body).items).toMatchObject([
        { actor: 'system', action: 'document.text_extracted' },
      ]);
      await http().get(`/api/v1/documents/${id}/activity`).set(bearer(bob)).expect(404);
    });
  });
});
