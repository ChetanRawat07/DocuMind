import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseExecutor } from '../../src/database/database.types.js';
import { insertDocument, insertJob, insertUser } from '../support/factories.js';
import { expectPgError, PG } from '../support/postgres-errors.js';
import { createTestDatabase, truncateAllTables } from '../support/test-database.js';

/**
 * Invariants the database enforces on its own, independent of application
 * code. Each test names the constraint it expects to fire.
 */
describe('schema constraints', () => {
  let db: DatabaseExecutor;
  let ownerId: string;

  beforeAll(() => {
    db = createTestDatabase();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    ownerId = (await insertUser(db)).id;
  });

  describe('users', () => {
    // Identity is the Supabase user id. The lazily synced email can be stale,
    // so two rows may briefly hold the same address (see migration 20261029140000).
    it('allows the same email on different identities', async () => {
      await insertUser(db, { email: 'ada@example.test' });

      await expect(insertUser(db, { email: 'ADA@example.test' })).resolves.toBeDefined();
    });

    it('maintains updated_at on every update', async () => {
      const before = await db
        .selectFrom('users')
        .select('updated_at')
        .where('id', '=', ownerId)
        .executeTakeFirstOrThrow();

      // now() is the transaction start time, so the update runs in a later transaction.
      await sql`SELECT pg_sleep(0.01)`.execute(db);
      const after = await db
        .updateTable('users')
        .set({ display_name: 'Ada' })
        .where('id', '=', ownerId)
        .returning('updated_at')
        .executeTakeFirstOrThrow();

      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    });
  });

  describe('documents', () => {
    it('rejects a non-positive size', async () => {
      const { id } = await insertDocument(db, ownerId);

      await expectPgError(
        db.updateTable('documents').set({ size_bytes: 0 }).where('id', '=', id).execute(),
        { code: PG.checkViolation, constraint: 'documents_size_bytes_check' },
      );
    });

    it('rejects a storage key that is already used', async () => {
      const { id } = await insertDocument(db, ownerId);
      const { id: otherId } = await insertDocument(db, ownerId);
      const taken = await db
        .selectFrom('documents')
        .select('storage_key')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      await expectPgError(
        db
          .updateTable('documents')
          .set({ storage_key: taken.storage_key })
          .where('id', '=', otherId)
          .execute(),
        { code: PG.uniqueViolation, constraint: 'documents_storage_key_key' },
      );
    });

    it.each([
      ['completed without processed_at', 'completed', null],
      ['queued with processed_at', 'queued', new Date()],
    ] as const)('rejects a document %s', async (_case, status, processedAt) => {
      const { id } = await insertDocument(db, ownerId);

      await expectPgError(
        db
          .updateTable('documents')
          .set({ status, processed_at: processedAt })
          .where('id', '=', id)
          .execute(),
        { code: PG.checkViolation, constraint: 'documents_processed_at_matches_status' },
      );
    });

    it('rejects an owner that does not exist', async () => {
      await expectPgError(insertDocument(db, randomUUID()), {
        code: PG.foreignKeyViolation,
        constraint: 'documents_user_id_fkey',
      });
    });

    it('refuses to delete a user who still owns documents', async () => {
      await insertDocument(db, ownerId);

      await expectPgError(db.deleteFrom('users').where('id', '=', ownerId).execute(), {
        code: PG.foreignKeyViolation,
        constraint: 'documents_user_id_fkey',
      });
    });

    it('cascades deletion to jobs and extractions but keeps audit history', async () => {
      const { id: documentId } = await insertDocument(db, ownerId);
      const { id: jobId } = await insertJob(db, documentId, 'succeeded');
      await db
        .insertInto('document_extractions')
        .values({
          document_id: documentId,
          job_id: jobId,
          document_type: 'invoice',
          schema_version: 1,
          fields: JSON.stringify({}),
          overall_confidence: 0.9,
          ai_provider: 'test',
          ai_model: 'test',
        })
        .execute();
      await db
        .insertInto('audit_logs')
        .values({
          actor_type: 'user',
          actor_user_id: ownerId,
          action: 'document.deleted',
          resource_type: 'document',
          resource_id: documentId,
        })
        .execute();

      await db.deleteFrom('documents').where('id', '=', documentId).execute();

      const counts = await sql<{ jobs: string; extractions: string; audit: string }>`
        SELECT
          (SELECT count(*) FROM processing_jobs) AS jobs,
          (SELECT count(*) FROM document_extractions) AS extractions,
          (SELECT count(*) FROM audit_logs WHERE resource_id = ${documentId}) AS audit
      `.execute(db);
      expect(counts.rows[0]).toEqual({ jobs: '0', extractions: '0', audit: '1' });
    });
  });

  describe('processing_jobs', () => {
    it('allows only one active job per document', async () => {
      const { id: documentId } = await insertDocument(db, ownerId);
      await insertJob(db, documentId);

      await expectPgError(insertJob(db, documentId), {
        code: PG.uniqueViolation,
        constraint: 'processing_jobs_one_active_per_document_key',
      });
    });

    it('allows a new job once the previous one has finished', async () => {
      const { id: documentId } = await insertDocument(db, ownerId);
      await insertJob(db, documentId, 'succeeded');

      await expect(insertJob(db, documentId)).resolves.toBeDefined();
    });

    it('rejects more attempts than allowed', async () => {
      const { id: documentId } = await insertDocument(db, ownerId);

      await expectPgError(
        db
          .insertInto('processing_jobs')
          .values({ document_id: documentId, attempts: 4, max_attempts: 3 })
          .execute(),
        { code: PG.checkViolation, constraint: 'processing_jobs_attempts_within_max' },
      );
    });

    it.each([
      ['a running job without a lease', { status: 'running' }],
      [
        'a queued job that holds a lease',
        {
          status: 'queued',
          locked_by: 'worker-1',
          locked_at: new Date(),
          lease_expires_at: new Date(Date.now() + 60_000),
        },
      ],
      [
        'a lease that expires before it was taken',
        {
          status: 'running',
          locked_by: 'worker-1',
          locked_at: new Date(),
          lease_expires_at: new Date(Date.now() - 60_000),
        },
      ],
    ] as const)('rejects %s', async (_case, values) => {
      const { id: documentId } = await insertDocument(db, ownerId);

      await expectPgError(
        db
          .insertInto('processing_jobs')
          .values({ document_id: documentId, ...values })
          .execute(),
        { code: PG.checkViolation, constraint: 'processing_jobs_lease_matches_status' },
      );
    });

    it('requires finished_at exactly for finished jobs', async () => {
      const { id: documentId } = await insertDocument(db, ownerId);

      await expectPgError(
        db
          .insertInto('processing_jobs')
          .values({ document_id: documentId, status: 'failed' })
          .execute(),
        { code: PG.checkViolation, constraint: 'processing_jobs_finished_at_matches_status' },
      );
    });
  });

  describe('document_extractions', () => {
    const extractionFor = (documentId: string, jobId: string) => ({
      document_id: documentId,
      job_id: jobId,
      document_type: 'invoice',
      schema_version: 1,
      fields: JSON.stringify({ total: { value: 100, confidence: 0.9 } }),
      overall_confidence: 0.9,
      ai_provider: 'test',
      ai_model: 'test',
    });

    it('rejects a job that belongs to a different document', async () => {
      const { id: documentId } = await insertDocument(db, ownerId);
      const { id: otherDocumentId } = await insertDocument(db, ownerId);
      const { id: otherJobId } = await insertJob(db, otherDocumentId, 'succeeded');

      await expectPgError(
        db
          .insertInto('document_extractions')
          .values(extractionFor(documentId, otherJobId))
          .execute(),
        { code: PG.foreignKeyViolation, constraint: 'document_extractions_job_document_fkey' },
      );
    });

    it('stores at most one extraction per job', async () => {
      const { id: documentId } = await insertDocument(db, ownerId);
      const { id: jobId } = await insertJob(db, documentId, 'succeeded');
      await db
        .insertInto('document_extractions')
        .values(extractionFor(documentId, jobId))
        .execute();

      await expectPgError(
        db.insertInto('document_extractions').values(extractionFor(documentId, jobId)).execute(),
        { code: PG.uniqueViolation, constraint: 'document_extractions_job_id_key' },
      );
    });

    it.each([
      [
        'fields that are not a JSON object',
        { fields: JSON.stringify([1, 2]) },
        'document_extractions_fields_check',
      ],
      [
        'a confidence above 1',
        { overall_confidence: 1.01 },
        'document_extractions_overall_confidence_check',
      ],
      [
        'a negative confidence',
        { overall_confidence: -0.01 },
        'document_extractions_overall_confidence_check',
      ],
    ] as const)('rejects %s', async (_case, override, constraint) => {
      const { id: documentId } = await insertDocument(db, ownerId);
      const { id: jobId } = await insertJob(db, documentId, 'succeeded');

      await expectPgError(
        db
          .insertInto('document_extractions')
          .values({ ...extractionFor(documentId, jobId), ...override })
          .execute(),
        { code: PG.checkViolation, constraint },
      );
    });
  });

  describe('row-level security', () => {
    it('shows no rows to a non-owner role, even one granted SELECT', async () => {
      const { id: documentId } = await insertDocument(db, ownerId);
      await insertJob(db, documentId);
      const rollback = new Error('rollback');

      // Runs in a transaction that is always rolled back, so the probe role never persists.
      const counts = await db
        .transaction()
        .execute(async (trx) => {
          await sql`CREATE ROLE rls_probe NOLOGIN`.execute(trx);
          await sql`GRANT SELECT ON ALL TABLES IN SCHEMA public TO rls_probe`.execute(trx);
          await sql`SET LOCAL ROLE rls_probe`.execute(trx);
          const result = await sql<Record<string, string>>`
            SELECT
              (SELECT count(*) FROM users) AS users,
              (SELECT count(*) FROM documents) AS documents,
              (SELECT count(*) FROM processing_jobs) AS processing_jobs,
              (SELECT count(*) FROM document_extractions) AS document_extractions,
              (SELECT count(*) FROM audit_logs) AS audit_logs
          `.execute(trx);
          throw Object.assign(rollback, { counts: result.rows[0] });
        })
        .catch((error: unknown) => {
          if (error !== rollback) throw error;
          return (error as Error & { counts: unknown }).counts;
        });

      expect(counts).toEqual({
        users: '0',
        documents: '0',
        processing_jobs: '0',
        document_extractions: '0',
        audit_logs: '0',
      });
    });
  });

  describe('audit_logs', () => {
    const entry = {
      actor_type: 'system',
      action: 'document.uploaded',
      resource_type: 'document',
    } as const;

    it('rejects updates (append-only)', async () => {
      const { id } = await db
        .insertInto('audit_logs')
        .values(entry)
        .returning('id')
        .executeTakeFirstOrThrow();

      await expectPgError(
        db
          .updateTable('audit_logs')
          .set({ action: 'document.deleted' })
          .where('id', '=', id)
          .execute(),
        { code: PG.restrictViolation },
      );
    });

    it('allows deletes, so retention can purge old entries', async () => {
      await db.insertInto('audit_logs').values(entry).execute();

      const result = await db.deleteFrom('audit_logs').executeTakeFirst();

      expect(result.numDeletedRows).toBe(1n);
    });

    it.each(['DocumentUploaded', 'document', 'document.', 'document.up-loaded', 'a.b.c'])(
      'rejects malformed action %j',
      async (action) => {
        await expectPgError(
          db
            .insertInto('audit_logs')
            .values({ ...entry, action })
            .execute(),
          {
            code: PG.checkViolation,
            constraint: 'audit_logs_action_check',
          },
        );
      },
    );

    it.each([
      ['a user actor without a user id', { actor_type: 'user' }],
      ['a system actor with a user id', { actor_type: 'system', actor_user_id: randomUUID() }],
    ] as const)('rejects %s', async (_case, actor) => {
      await expectPgError(
        db
          .insertInto('audit_logs')
          .values({ ...entry, ...actor })
          .execute(),
        {
          code: PG.checkViolation,
          constraint: 'audit_logs_actor_matches_type',
        },
      );
    });
  });
});
