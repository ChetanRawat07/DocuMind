import { NO_MIGRATIONS } from 'kysely/migration';
import { runEntrypoint } from '../common/bootstrap/run-entrypoint.js';
import { loadConfig } from '../config/app-config.js';
import { createDatabase } from './create-database.js';
import { assertMigrationSucceeded, createMigrator } from './migrator.js';

const COMMANDS = ['latest', 'down', 'reset'] as const;
type Command = (typeof COMMANDS)[number];

const isCommand = (value: string | undefined): value is Command =>
  COMMANDS.some((command) => command === value);

/**
 * Migration CLI: `node dist/database/migrate.js <latest|down|reset>`.
 * - latest: apply all pending migrations (the only command used in deployment).
 * - down:   revert the most recent migration.
 * - reset:  revert every migration; refused when NODE_ENV=production.
 */
runEntrypoint('migrate', async () => {
  const command = process.argv[2] ?? 'latest';
  if (!isCommand(command)) {
    throw new Error(`Unknown command "${command}". Use one of: ${COMMANDS.join(', ')}`);
  }

  const config = loadConfig(process.env);
  if (command === 'reset' && config.nodeEnv === 'production') {
    throw new Error('Refusing to revert all migrations when NODE_ENV=production');
  }

  const db = createDatabase(config.database, 'documind-migrate');
  try {
    const migrator = createMigrator(db);
    const resultSet =
      command === 'latest'
        ? await migrator.migrateToLatest()
        : command === 'down'
          ? await migrator.migrateDown()
          : await migrator.migrateTo(NO_MIGRATIONS);

    for (const result of resultSet.results ?? []) {
      process.stdout.write(`${result.status}: ${result.direction} ${result.migrationName}\n`);
    }
    if (resultSet.results?.length === 0) {
      process.stdout.write('Nothing to do\n');
    }
    assertMigrationSucceeded(resultSet);
  } finally {
    await db.destroy();
  }
});
