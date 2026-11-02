import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertDocument, insertUser } from '../../test/support/factories.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { type ProcessingJob, ProcessingJobsRepository } from './processing-jobs.repository.js';

const LEASE_MS = 60_000;
const ERROR = { code: 'ai_unavailable', message: 'ollama: unavailable' };

describe('ProcessingJobsRepository', () => {
  let db: DatabaseExecutor;
  let jobs: ProcessingJobsRepository;
  let documentId: string;

  beforeAll(() => {
    db = createTestDatabase();
    jobs = new ProcessingJobsRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const owner = await insertUser(db);
    documentId = (await insertDocument(db, owner.id)).id;
  });

  it('creates a queued job with default retry settings', async () => {
    const { job, created } = await jobs.enqueue(documentId);

    expect(created).toBe(true);
    expect(job).toMatchObject({
      documentId,
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      lockedBy: null,
      finishedAt: null,
    });
  });

  it('returns the existing active job for a duplicate request', async () => {
    const first = await jobs.enqueue(documentId);

    const second = await jobs.enqueue(documentId);

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it('creates exactly one job when many requests arrive at once', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => jobs.enqueue(documentId)));

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.job.id)).size).toBe(1);
    const count = await db
      .selectFrom('processing_jobs')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    expect(count.count).toBe('1');
  });

  it('creates a new job once the previous one has finished (reprocessing)', async () => {
    const first = await jobs.enqueue(documentId);
    await db
      .updateTable('processing_jobs')
      .set({ status: 'succeeded', finished_at: new Date() })
      .where('id', '=', first.job.id)
      .execute();

    const second = await jobs.enqueue(documentId);

    expect(second.created).toBe(true);
    expect(second.job.id).not.toBe(first.job.id);
  });

  it('finds no active job for a document without one', async () => {
    expect(await jobs.findActiveForDocument(documentId)).toBeNull();
  });

  /** Makes a running job's lease run out, as if its worker had crashed an hour ago. */
  async function expireLease(jobId: string): Promise<void> {
    await db
      .updateTable('processing_jobs')
      .set({
        locked_at: sql<Date>`now() - interval '2 hours'`,
        lease_expires_at: sql<Date>`now() - interval '1 hour'`,
      })
      .where('id', '=', jobId)
      .execute();
  }

  async function claimOrThrow(workerId = 'worker-a'): Promise<ProcessingJob> {
    const job = await jobs.claimNext(workerId, LEASE_MS);
    if (!job) throw new Error('expected a claimable job');
    return job;
  }

  describe('claimNext', () => {
    it('starts an attempt on the oldest due job under a lease', async () => {
      const owner = await insertUser(db);
      const later = (await insertDocument(db, owner.id)).id;
      const { job: oldest } = await jobs.enqueue(documentId);
      await jobs.enqueue(later);

      const job = await claimOrThrow();

      expect(job).toMatchObject({
        id: oldest.id,
        status: 'running',
        attempts: 1,
        lockedBy: 'worker-a',
      });
      expect(job.startedAt).not.toBeNull();
      const leaseMs = (job.leaseExpiresAt?.getTime() ?? 0) - (job.lockedAt?.getTime() ?? 0);
      expect(leaseMs).toBe(LEASE_MS);
    });

    it('leaves jobs that are not due yet', async () => {
      const { job } = await jobs.enqueue(documentId);
      await db
        .updateTable('processing_jobs')
        .set({ available_at: sql<Date>`now() + interval '1 minute'` })
        .where('id', '=', job.id)
        .execute();

      expect(await jobs.claimNext('worker-a', LEASE_MS)).toBeNull();
    });

    it('gives each job to exactly one of several concurrent workers', async () => {
      const owner = await insertUser(db);
      for (let index = 0; index < 4; index += 1) {
        await jobs.enqueue((await insertDocument(db, owner.id)).id);
      }
      await jobs.enqueue(documentId);

      const claims = await Promise.all(
        Array.from({ length: 8 }, (_, index) => jobs.claimNext(`worker-${index}`, LEASE_MS)),
      );

      const claimed = claims.filter((job) => job !== null);
      expect(claimed).toHaveLength(5);
      expect(new Set(claimed.map((job) => job.id)).size).toBe(5);
    });
  });

  describe('finishing an attempt', () => {
    it('schedules a retry: queued again, unlocked, due later, with the error', async () => {
      await jobs.enqueue(documentId);
      const job = await claimOrThrow();
      const retryAt = new Date(Date.now() + 60_000);

      expect(await jobs.scheduleRetry(job, ERROR, retryAt)).toBe(true);

      expect(await jobs.findActiveForDocument(documentId)).toMatchObject({
        status: 'queued',
        attempts: 1,
        availableAt: retryAt,
        lockedBy: null,
        leaseExpiresAt: null,
        lastErrorCode: 'ai_unavailable',
        finishedAt: null,
      });
      expect(await jobs.claimNext('worker-a', LEASE_MS)).toBeNull();
    });

    it('marks a job failed for good, keeping the stage it failed in', async () => {
      await jobs.enqueue(documentId);
      const job = await claimOrThrow();
      await jobs.setStage(job, 'ai_extraction');

      expect(await jobs.markFailed(job, { code: 'no_text', message: 'x'.repeat(3000) })).toBe(true);

      const [failed] = await jobs.listForDocument(documentId, 1);
      expect(failed).toMatchObject({ status: 'failed', stage: 'ai_extraction', lockedBy: null });
      expect(failed?.finishedAt).not.toBeNull();
      expect(failed?.lastErrorMessage).toHaveLength(2000);
    });

    it('marks a job succeeded', async () => {
      await jobs.enqueue(documentId);
      const job = await claimOrThrow();

      expect(await jobs.markSucceeded(job)).toBe(true);

      const [succeeded] = await jobs.listForDocument(documentId, 1);
      expect(succeeded).toMatchObject({ status: 'succeeded', stage: null, lockedBy: null });
    });

    it('refuses every write from a worker whose claim was taken over', async () => {
      await jobs.enqueue(documentId);
      const stale = await claimOrThrow('worker-a');
      await expireLease(stale.id);
      await jobs.releaseExpired();
      const current = await claimOrThrow('worker-b');

      expect(await jobs.setStage(stale, 'ai_extraction')).toBe(false);
      expect(await jobs.markSucceeded(stale)).toBe(false);
      expect(await jobs.markFailed(stale, ERROR)).toBe(false);
      expect(await jobs.scheduleRetry(stale, ERROR, new Date())).toBe(false);

      expect(await jobs.markSucceeded(current)).toBe(true);
    });

    it('tells two attempts by the same worker apart', async () => {
      await jobs.enqueue(documentId);
      const first = await claimOrThrow('worker-a');
      await expireLease(first.id);
      await jobs.releaseExpired();
      await claimOrThrow('worker-a');

      expect(await jobs.markSucceeded(first)).toBe(false);
    });
  });

  describe('releaseExpired', () => {
    it('requeues an expired job with attempts left and fails one without', async () => {
      const owner = await insertUser(db);
      const otherDocument = (await insertDocument(db, owner.id)).id;
      await jobs.enqueue(documentId);
      const withAttemptsLeft = await claimOrThrow();
      await jobs.enqueue(otherDocument);
      const exhausted = await claimOrThrow();
      await db
        .updateTable('processing_jobs')
        .set({ attempts: 3 })
        .where('id', '=', exhausted.id)
        .execute();
      await expireLease(withAttemptsLeft.id);
      await expireLease(exhausted.id);

      const released = await jobs.releaseExpired();

      const byId = new Map(released.map((job) => [job.id, job]));
      expect(byId.get(withAttemptsLeft.id)).toMatchObject({
        status: 'queued',
        lockedBy: null,
        lastErrorCode: 'lease_expired',
        finishedAt: null,
      });
      expect(byId.get(exhausted.id)).toMatchObject({
        status: 'failed',
        lastErrorCode: 'lease_expired',
      });
      expect(byId.get(exhausted.id)?.finishedAt).not.toBeNull();
    });

    it('leaves running jobs whose lease is still valid', async () => {
      await jobs.enqueue(documentId);
      await claimOrThrow();

      expect(await jobs.releaseExpired()).toEqual([]);
    });
  });

  it('lists the jobs of a document newest first', async () => {
    const first = await jobs.enqueue(documentId);
    await jobs.markSucceeded(await claimOrThrow());
    const second = await jobs.enqueue(documentId);

    const listed = await jobs.listForDocument(documentId, 10);

    expect(listed.map((job) => job.id)).toEqual([second.job.id, first.job.id]);
    expect(await jobs.listForDocument(documentId, 1)).toHaveLength(1);
  });
});
