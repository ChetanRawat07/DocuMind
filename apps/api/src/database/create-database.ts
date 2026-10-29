import { Logger } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { AppConfig } from '../config/app-config.js';
import type { Database } from './database.types.js';

/** A transaction stops being useful long before this; the server ends it and frees its locks. */
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;
const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_CONNECTION_TIMEOUT_MS = 30_000;

/**
 * Creates the process-wide connection pool and query builder.
 *
 * No session state is relied on (no named prepared statements, no session
 * advisory locks), so the same code works through a transaction-mode pooler
 * such as Supabase's Supavisor.
 */
export function createDatabase(
  config: AppConfig['database'],
  applicationName: string,
): Kysely<Database> {
  const pool = new Pool({
    connectionString: config.url,
    max: config.poolMax,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_CONNECTION_TIMEOUT_MS,
    statement_timeout: config.statementTimeoutMs,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    // Identifies the process in pg_stat_activity.
    application_name: applicationName,
  });

  // An idle client can fail (for example, on a database restart). Without a
  // listener the pool re-emits it as an uncaught error and crashes the process.
  const logger = new Logger('DatabasePool');
  pool.on('error', (error) => {
    logger.error(`Idle database client error: ${error.message}`);
  });

  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
