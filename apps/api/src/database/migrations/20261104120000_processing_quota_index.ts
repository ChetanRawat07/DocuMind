import { type Kysely, sql } from 'kysely';

/*
 * Phase 13: the daily processing quota counts a user's uploads and
 * reprocessing requests of the last 24 hours. Counted from the append-only
 * audit log, so deleting documents does not give the quota back. Partial: the
 * other actions are far more numerous and never counted.
 * See docs/security/security-review.md.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX audit_logs_processing_requests_idx
    ON audit_logs (actor_user_id, occurred_at)
    WHERE action IN ('document.uploaded', 'document.processing_requested')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX audit_logs_processing_requests_idx`.execute(db);
}
