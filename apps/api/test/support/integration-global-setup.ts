import { sql } from 'kysely';
import { createDatabase } from '../../src/database/create-database.js';
import { assertMigrationSucceeded, createMigrator } from '../../src/database/migrator.js';
import { createTestDatabase, resolveTestDatabase } from './test-database.js';

/** Recreates the test database from scratch and applies every migration, once per test run. */
export default async function setup(): Promise<void> {
  const target = resolveTestDatabase();

  const maintenance = createDatabase(
    { url: target.maintenanceUrl, poolMax: 1, statementTimeoutMs: 30_000 },
    'documind-test-setup',
  );
  try {
    // Identifiers cannot be bound as parameters; the name was validated against
    // a strict pattern in resolveTestDatabase.
    await sql`DROP DATABASE IF EXISTS ${sql.id(target.databaseName)} WITH (FORCE)`.execute(
      maintenance,
    );
    await sql`CREATE DATABASE ${sql.id(target.databaseName)}`.execute(maintenance);
  } finally {
    await maintenance.destroy();
  }

  const db = createTestDatabase(target.url);
  try {
    assertMigrationSucceeded(await createMigrator(db).migrateToLatest());
  } finally {
    await db.destroy();
  }
}
