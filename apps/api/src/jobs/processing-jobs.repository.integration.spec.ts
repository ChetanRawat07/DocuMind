import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertDocument, insertUser } from '../../test/support/factories.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { ProcessingJobsRepository } from './processing-jobs.repository.js';

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
});
