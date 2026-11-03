import { type Kysely, sql } from 'kysely';

/*
 * Phase 12: analytics reads "the user's documents processed since X". Partial:
 * documents still waiting have no processed_at and are never in the range.
 * See docs/operations/analytics.md.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX documents_user_id_processed_at_idx
    ON documents (user_id, processed_at) WHERE processed_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX documents_user_id_processed_at_idx`.execute(db);
}
