import { type Kysely, sql } from 'kysely';

/*
 * Phase 15 (docs/operations/performance-review.md, ADR-020):
 *
 * - processing_jobs.user_id: a copy of the document's owner, so a user's jobs
 *   are read through their own index instead of scanning every job of every
 *   user. The composite foreign key keeps it equal to documents.user_id.
 * - An index on extraction_reviews.decided_by: deleting a user checks this
 *   foreign key, which otherwise scans every review.
 * - JIT off for the application's role: its compile time exceeded the run
 *   time of the queries it triggered on. A role setting, because Supabase's
 *   transaction-mode pooler does not keep session settings.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE documents ADD CONSTRAINT documents_id_user_id_key UNIQUE (id, user_id)`.execute(
    db,
  );
  await sql`ALTER TABLE processing_jobs ADD COLUMN user_id uuid`.execute(db);
  await sql`
    UPDATE processing_jobs j SET user_id = d.user_id FROM documents d WHERE d.id = j.document_id
  `.execute(db);
  await sql`ALTER TABLE processing_jobs ALTER COLUMN user_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE processing_jobs DROP CONSTRAINT processing_jobs_document_id_fkey`.execute(
    db,
  );
  await sql`
    ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_document_owner_fkey
    FOREIGN KEY (document_id, user_id) REFERENCES documents (id, user_id) ON DELETE CASCADE
  `.execute(db);
  // The owner's job list, newest first.
  await sql`
    CREATE INDEX processing_jobs_user_id_created_at_id_idx
    ON processing_jobs (user_id, created_at DESC, id DESC)
  `.execute(db);
  // The summary: active jobs (finished_at IS NULL) and jobs finished in the window.
  await sql`
    CREATE INDEX processing_jobs_user_id_finished_at_idx ON processing_jobs (user_id, finished_at)
  `.execute(db);

  await sql`
    CREATE INDEX extraction_reviews_decided_by_idx
    ON extraction_reviews (decided_by) WHERE decided_by IS NOT NULL
  `.execute(db);

  await sql`ALTER ROLE CURRENT_USER SET jit = off`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER ROLE CURRENT_USER RESET jit`.execute(db);
  await sql`DROP INDEX extraction_reviews_decided_by_idx`.execute(db);
  await sql`DROP INDEX processing_jobs_user_id_finished_at_idx`.execute(db);
  await sql`DROP INDEX processing_jobs_user_id_created_at_id_idx`.execute(db);
  await sql`ALTER TABLE processing_jobs DROP CONSTRAINT processing_jobs_document_owner_fkey`.execute(
    db,
  );
  await sql`
    ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_document_id_fkey
    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
  `.execute(db);
  await sql`ALTER TABLE processing_jobs DROP COLUMN user_id`.execute(db);
  await sql`ALTER TABLE documents DROP CONSTRAINT documents_id_user_id_key`.execute(db);
}
