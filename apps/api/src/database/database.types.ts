import type { Kysely } from 'kysely';
import type { DB } from './generated/database.js';

export type Database = DB;

/**
 * What repositories run queries against: the shared Kysely instance or an open
 * transaction (Kysely's Transaction extends Kysely). Passing a transaction makes
 * several repository calls commit or roll back together.
 */
export type DatabaseExecutor = Kysely<Database>;
