import type { Kysely } from 'kysely';
import type { Database } from './database.types.js';
import { type MigrationResultSet, Migrator } from 'kysely/migration';
import { migrations } from './migrations/index.js';

export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });
}

/** Turns Kysely's result set into a thrown error, so callers cannot ignore a failure. */
export function assertMigrationSucceeded(resultSet: MigrationResultSet): void {
  if (resultSet.error === undefined) return;

  const failed = resultSet.results?.find((result) => result.status === 'Error');
  const reason = resultSet.error instanceof Error ? resultSet.error.message : 'unknown error';
  throw new Error(
    failed ? `Migration ${failed.migrationName} failed: ${reason}` : `Migration failed: ${reason}`,
  );
}
