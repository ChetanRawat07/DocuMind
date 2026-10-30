import { sql } from 'kysely';
import { createDatabase } from '../../src/database/create-database.js';
import type { DatabaseExecutor } from '../../src/database/database.types.js';

const TEST_DATABASE_NAME = /^[a-z0-9_]+_test$/;

export interface TestDatabaseTarget {
  readonly url: string;
  readonly databaseName: string;
  /** Same server, `postgres` maintenance database: used to drop and create the test database. */
  readonly maintenanceUrl: string;
}

/**
 * Reads TEST_DATABASE_URL and refuses anything whose database name does not
 * end in `_test`, because the suite drops and recreates that database.
 */
export function resolveTestDatabase(): TestDatabaseTarget {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env and run `npm run infra:up`.',
    );
  }
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error('TEST_DATABASE_URL must name a database matching [a-z0-9_]+_test');
  }
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  return { url, databaseName, maintenanceUrl: maintenance.toString() };
}

export function createTestDatabase(url = resolveTestDatabase().url): DatabaseExecutor {
  return createDatabase({ url, poolMax: 10, statementTimeoutMs: 10_000 }, 'documind-test');
}

/** Empties every application table. Faster than recreating the schema per test. */
export async function truncateAllTables(db: DatabaseExecutor): Promise<void> {
  await sql`
    TRUNCATE audit_logs, document_text_pages, document_texts, document_extractions, processing_jobs,
      documents, users
    RESTART IDENTITY CASCADE
  `.execute(db);
}
