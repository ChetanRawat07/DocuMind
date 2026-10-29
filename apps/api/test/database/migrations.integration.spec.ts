import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  PROCESSED_DOCUMENT_STATUSES,
  PROCESSING_JOB_STATUSES,
  PROCESSING_STAGES,
} from '@documind/shared';
import { sql } from 'kysely';
import { NO_MIGRATIONS } from 'kysely/migration';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseExecutor } from '../../src/database/database.types.js';
import { assertMigrationSucceeded, createMigrator } from '../../src/database/migrator.js';
import { insertDocument, insertUser } from '../support/factories.js';
import { expectPgError, PG } from '../support/postgres-errors.js';
import { createTestDatabase, truncateAllTables } from '../support/test-database.js';

const APPLICATION_TABLES = [
  'audit_logs',
  'document_extractions',
  'documents',
  'processing_jobs',
  'users',
];

async function listApplicationTables(db: DatabaseExecutor): Promise<string[]> {
  const result = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'
    ORDER BY table_name
  `.execute(db);
  return result.rows.map((row) => row.table_name);
}

describe('migrations', () => {
  let db: DatabaseExecutor;

  beforeAll(() => {
    db = createTestDatabase();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('reverts completely and re-applies cleanly', async () => {
    const migrator = createMigrator(db);

    assertMigrationSucceeded(await migrator.migrateTo(NO_MIGRATIONS));
    expect(await listApplicationTables(db)).toEqual([]);

    assertMigrationSucceeded(await migrator.migrateToLatest());
    expect(await listApplicationTables(db)).toEqual(APPLICATION_TABLES);
  });

  it('reports nothing to do when already at the latest migration', async () => {
    const resultSet = await createMigrator(db).migrateToLatest();

    assertMigrationSucceeded(resultSet);
    expect(resultSet.results).toEqual([]);
  });
});

/**
 * The migration hard-codes allowed values; the application uses the shared
 * constants. These tests fail if the two ever disagree.
 */
describe('CHECK constraints match the shared constants', () => {
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

  it.each(DOCUMENT_STATUSES)('accepts document status %s', async (status) => {
    const { id } = await insertDocument(db, ownerId);
    const processedAt = (PROCESSED_DOCUMENT_STATUSES as readonly string[]).includes(status)
      ? new Date()
      : null;

    await db
      .updateTable('documents')
      .set({ status, processed_at: processedAt })
      .where('id', '=', id)
      .execute();
  });

  it.each(DOCUMENT_TYPES)('accepts document type %s', async (documentType) => {
    const { id } = await insertDocument(db, ownerId);
    await db
      .updateTable('documents')
      .set({ document_type: documentType })
      .where('id', '=', id)
      .execute();
  });

  it.each(PROCESSING_STAGES)('accepts processing stage %s', async (stage) => {
    const { id } = await insertDocument(db, ownerId);
    await db.insertInto('processing_jobs').values({ document_id: id, stage }).execute();
  });

  it.each(PROCESSING_JOB_STATUSES)('accepts job status %s', async (status) => {
    const { id } = await insertDocument(db, ownerId);
    const now = new Date();
    await db
      .insertInto('processing_jobs')
      .values({
        document_id: id,
        status,
        ...(status === 'running'
          ? { locked_by: 'worker-1', locked_at: now, lease_expires_at: new Date(now.getTime() + 1) }
          : {}),
        ...(status === 'succeeded' || status === 'failed' ? { finished_at: now } : {}),
      })
      .execute();
  });

  it.each([
    ['documents.status', 'documents_status_check'],
    ['documents.document_type', 'documents_document_type_check'],
    ['processing_jobs.status', 'processing_jobs_status_check'],
    ['processing_jobs.stage', 'processing_jobs_stage_check'],
  ])('rejects an unknown value for %s', async (column, constraint) => {
    const { id } = await insertDocument(db, ownerId);
    const operation =
      column === 'documents.status'
        ? db.updateTable('documents').set({ status: 'archived' }).where('id', '=', id).execute()
        : column === 'documents.document_type'
          ? db
              .updateTable('documents')
              .set({ document_type: 'receipt' })
              .where('id', '=', id)
              .execute()
          : db
              .insertInto('processing_jobs')
              .values(
                column === 'processing_jobs.status'
                  ? { document_id: id, status: 'paused' }
                  : { document_id: id, stage: 'translation' },
              )
              .execute();

    await expectPgError(operation, { code: PG.checkViolation, constraint });
  });
});
