import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiErrorResponseSchema, documentListResponseSchema } from '@documind/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { JWT_KEY_RESOLVER } from '../src/auth/access-token-verifier.js';
import { RATE_LIMITS } from '../src/auth/rate-limit.guard.js';
import { loadConfig } from '../src/config/app-config.js';
import type { DatabaseExecutor } from '../src/database/database.types.js';
import {
  DAILY_PROCESSING_QUOTA,
  ProcessingQuota,
  ProcessingQuotaExceededError,
} from '../src/documents/processing-quota.js';
import { configureHttpApp } from '../src/http/configure-http-app.js';
import { insertJob } from './support/factories.js';
import { TEST_SUPABASE_URL, TestTokenIssuer } from './support/test-auth.js';
import {
  createTestDatabase,
  resolveTestDatabase,
  truncateAllTables,
} from './support/test-database.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');

describe('rate limits, processing quota and data erasure (HTTP)', () => {
  let app: INestApplication<Server>;
  let db: DatabaseExecutor;
  let issuer: TestTokenIssuer;
  let storageRoot: string;
  let aliceId: string;
  let alice: string;
  let bob: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const upload = (token: string) =>
    http().post('/api/v1/documents').set(bearer(token)).attach('file', PDF, 'invoice.pdf');

  async function storedFiles(): Promise<string[]> {
    const entries = await readdir(storageRoot, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  async function documentsOf(userId: string): Promise<number> {
    const row = await db
      .selectFrom('documents')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  /** Uses up the quota with audit entries, as earlier uploads would have left them. */
  async function useQuota(userId: string, count: number, hoursAgo = 1) {
    await sql`
      INSERT INTO audit_logs (actor_type, actor_user_id, action, resource_type, resource_id, occurred_at)
      SELECT 'user', ${userId}, CASE WHEN n % 2 = 0 THEN 'document.uploaded' ELSE 'document.processing_requested' END,
             'document', gen_random_uuid(), now() - make_interval(hours => ${hoursAgo})
      FROM generate_series(1, ${count}) n
    `.execute(db);
  }

  beforeAll(async () => {
    issuer = await TestTokenIssuer.create();
    db = createTestDatabase();
    storageRoot = await mkdtemp(join(tmpdir(), 'documind-security-test-'));
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
    await rm(storageRoot, { recursive: true, force: true });
    await mkdir(storageRoot);
    aliceId = randomUUID();
    alice = await issuer.sign(aliceId, { claims: { email: 'alice@example.test' } });
    bob = await issuer.sign(randomUUID(), { claims: { email: 'bob@example.test' } });
    // Provision both users.
    await http().get('/api/v1/me').set(bearer(alice)).expect(200);
    await http().get('/api/v1/me').set(bearer(bob)).expect(200);
  });

  describe('rate limits', () => {
    it('answers 429 with Retry-After once a user exceeds the processing limit, before storing anything', async () => {
      for (let i = 0; i < RATE_LIMITS.processing.limit; i += 1) await upload(alice).expect(201);

      const limited = await upload(alice).expect(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(apiErrorResponseSchema.parse(limited.body).error.code).toBe('TOO_MANY_REQUESTS');
      expect(await documentsOf(aliceId)).toBe(RATE_LIMITS.processing.limit);
      expect(await storedFiles()).toHaveLength(RATE_LIMITS.processing.limit);

      // Other users and other routes are unaffected.
      await upload(bob).expect(201);
      await http().get('/api/v1/documents').set(bearer(alice)).expect(200);
    });

    it('rejects a request without a valid token with 401, never counting it', async () => {
      for (let i = 0; i < RATE_LIMITS.processing.limit + 1; i += 1) {
        await http().post('/api/v1/documents').attach('file', PDF, 'x.pdf').expect(401);
      }
    });
  });

  describe('processing quota', () => {
    it(`allows ${String(DAILY_PROCESSING_QUOTA)} processing requests per 24 hours, then 429 without storing`, async () => {
      await useQuota(aliceId, DAILY_PROCESSING_QUOTA - 1);
      await upload(alice).expect(201);

      const refused = await upload(alice).expect(429);
      expect(apiErrorResponseSchema.parse(refused.body).error.message).toMatch(
        /^Processing limit reached: 50 documents per 24 hours/,
      );
      expect(await documentsOf(aliceId)).toBe(1);
      expect(await storedFiles()).toHaveLength(1);
      await upload(bob).expect(201);
    });

    it('does not count requests older than 24 hours', async () => {
      await useQuota(aliceId, DAILY_PROCESSING_QUOTA, 25);
      await upload(alice).expect(201);
    });

    it('still counts uploads whose documents were deleted', async () => {
      await useQuota(aliceId, DAILY_PROCESSING_QUOTA - 1);
      const { id } = (await upload(alice).expect(201)).body as { id: string };
      await http().delete(`/api/v1/documents/${id}`).set(bearer(alice)).expect(204);
      await upload(alice).expect(429);
    });

    it('lets exactly one of two concurrent uploads take the last slot', async () => {
      await useQuota(aliceId, DAILY_PROCESSING_QUOTA - 1);
      const statuses = await Promise.all([upload(alice), upload(alice)]).then((responses) =>
        responses.map((response) => response.status).sort(),
      );
      expect(statuses).toEqual([201, 429]);
      expect(await documentsOf(aliceId)).toBe(1);
      expect(await storedFiles()).toHaveLength(1);
    });

    it("makes a user's second request wait for the first to commit, then counts it", async () => {
      await useQuota(aliceId, DAILY_PROCESSING_QUOTA - 1);
      const quota = new ProcessingQuota();
      let release = () => {};
      const released = new Promise<void>((resolve) => (release = resolve));
      let firstHoldsLock = () => {};
      const locked = new Promise<void>((resolve) => (firstHoldsLock = resolve));

      const first = db.transaction().execute(async (trx) => {
        await quota.assertAvailable(aliceId, trx);
        await useQuota(aliceId, 1);
        firstHoldsLock();
        await released;
      });
      await locked;
      let secondDone = false;
      const second = db
        .transaction()
        .execute((trx) => quota.assertAvailable(aliceId, trx))
        .finally(() => (secondDone = true));

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(secondDone).toBe(false);
      release();
      await first;
      await expect(second).rejects.toBeInstanceOf(ProcessingQuotaExceededError);
    });

    it('refuses reprocessing over the quota and leaves the document as it was', async () => {
      const { id } = (await upload(alice).expect(201)).body as { id: string };
      await db
        .updateTable('processing_jobs')
        .set({ status: 'failed', finished_at: new Date() })
        .execute();
      await sql`UPDATE documents SET status = 'failed', processed_at = now() WHERE id = ${id}`.execute(
        db,
      );
      await useQuota(aliceId, DAILY_PROCESSING_QUOTA - 1);

      await http().post(`/api/v1/documents/${id}/jobs`).set(bearer(alice)).expect(429);
      const document = await db
        .selectFrom('documents')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(document.status).toBe('failed');
    });

    it('answers a repeated request for a queued document without using the quota', async () => {
      const { id } = (await upload(alice).expect(201)).body as { id: string };
      await useQuota(aliceId, DAILY_PROCESSING_QUOTA);
      await http().post(`/api/v1/documents/${id}/jobs`).set(bearer(alice)).expect(202);
    });
  });

  describe('DELETE /me', () => {
    it("erases the user's documents, files and profile, and nothing of anyone else's", async () => {
      const first = await upload(alice).expect(201);
      await upload(alice).expect(201);
      await upload(bob).expect(201);
      // A reviewed extraction references the user (decided_by) and must go with the document.
      const documentId = (first.body as { id: string }).id;
      const job = await insertJob(db, documentId, 'succeeded');
      const extraction = await db
        .insertInto('document_extractions')
        .values({
          document_id: documentId,
          job_id: job.id,
          document_type: 'invoice',
          schema_version: 1,
          fields: JSON.stringify({}),
          overall_confidence: 0.5,
          classification_confidence: 0.95,
          validation_issues: JSON.stringify([]),
          ai_provider: 'test',
          ai_model: 'test',
          classification_prompt: 'test@1',
          extraction_prompt: 'test@1',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('extraction_reviews')
        .values({
          extraction_id: extraction.id,
          fields: JSON.stringify({}),
          decision: 'approved',
          decided_by: aliceId,
          decided_at: new Date(),
        })
        .execute();

      await http().delete('/api/v1/me').set(bearer(alice)).expect(204);

      expect(await documentsOf(aliceId)).toBe(0);
      expect(await storedFiles()).toHaveLength(1);
      expect(
        await db.selectFrom('users').select('id').where('id', '=', aliceId).executeTakeFirst(),
      ).toBeUndefined();
      const erased = await db
        .selectFrom('audit_logs')
        .select(['resource_id', 'metadata'])
        .where('action', '=', 'user.data_erased')
        .execute();
      expect(erased).toEqual([{ resource_id: aliceId, metadata: { documents: 2 } }]);
      // Bob is untouched.
      const list = await http().get('/api/v1/documents').set(bearer(bob)).expect(200);
      expect(documentListResponseSchema.parse(list.body).items).toHaveLength(1);
    });

    it('starts an empty profile on the next request, and keeps the quota used', async () => {
      await useQuota(aliceId, DAILY_PROCESSING_QUOTA - 1);
      await upload(alice).expect(201);
      await http().delete('/api/v1/me').set(bearer(alice)).expect(204);

      const me = await http().get('/api/v1/me').set(bearer(alice)).expect(200);
      expect((me.body as { id: string }).id).toBe(aliceId);
      const list = await http().get('/api/v1/documents').set(bearer(alice)).expect(200);
      expect(documentListResponseSchema.parse(list.body).items).toEqual([]);
      await upload(alice).expect(429);
    });

    it('requires authentication', async () => {
      await http().delete('/api/v1/me').expect(401);
    });
  });
});
