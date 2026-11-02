import { type Kysely, sql } from 'kysely';

/*
 * Phase 11: correlation and timings. See docs/operations/observability.md.
 *
 * - processing_jobs.request_id: the API request that queued the job, so the
 *   worker's logs and audit entries can be traced back to it.
 * - processing_jobs.text_extraction_ms and ai_ms: how long each step took
 *   (in the attempt that last ran it), for the Processing screen.
 * - The audit log is paged by id; the actor index is rebuilt to match.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE processing_jobs
      ADD COLUMN request_id text CHECK (char_length(request_id) BETWEEN 1 AND 100),
      ADD COLUMN text_extraction_ms integer CHECK (text_extraction_ms >= 0),
      ADD COLUMN ai_ms integer CHECK (ai_ms >= 0)
  `.execute(db);
  await sql`DROP INDEX audit_logs_actor_user_id_occurred_at_idx`.execute(db);
  // A user's own entries, newest first (identity ids increase with insertion).
  await sql`
    CREATE INDEX audit_logs_actor_user_id_id_idx
    ON audit_logs (actor_user_id, id DESC) WHERE actor_user_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX audit_logs_actor_user_id_id_idx`.execute(db);
  await sql`
    CREATE INDEX audit_logs_actor_user_id_occurred_at_idx
    ON audit_logs (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL
  `.execute(db);
  await sql`
    ALTER TABLE processing_jobs
      DROP COLUMN ai_ms,
      DROP COLUMN text_extraction_ms,
      DROP COLUMN request_id
  `.execute(db);
}
