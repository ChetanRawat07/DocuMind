import { type Kysely, sql } from 'kysely';

/*
 * Phase 10: human review of extractions. See docs/processing/review-workflow.md.
 *
 * - documents.status gains `rejected`: a reviewer found the extraction
 *   unusable. It is an outcome, so processed_at is set.
 * - extraction_reviews holds the reviewer's work on one extraction, kept
 *   apart from document_extractions so the model's output stays unchanged
 *   and auditable.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE documents
      DROP CONSTRAINT documents_status_check,
      ADD CONSTRAINT documents_status_check
        CHECK (status IN ('uploaded', 'queued', 'processing',
                          'needs_review', 'completed', 'failed', 'rejected')),
      DROP CONSTRAINT documents_processed_at_matches_status,
      ADD CONSTRAINT documents_processed_at_matches_status CHECK (
        (status IN ('needs_review', 'completed', 'failed', 'rejected')) = (processed_at IS NOT NULL)
      )
  `.execute(db);

  // At most one per extraction, created by the first review action or by automatic approval.
  await sql`
    CREATE TABLE extraction_reviews (
      extraction_id uuid        PRIMARY KEY REFERENCES document_extractions (id) ON DELETE CASCADE,
      -- Confirmed or corrected fields: {"totalAmount": {"value": 58200}}. Document content.
      fields        jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(fields) = 'object'),
      decision      text        CHECK (decision IN ('approved', 'rejected')),
      -- The reviewing user; null for an automatic approval.
      decided_by    uuid        REFERENCES users (id),
      decided_at    timestamptz,
      reject_reason text        CHECK (char_length(reject_reason) BETWEEN 1 AND 500),
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT extraction_reviews_decided_at_matches_decision CHECK (
        (decision IS NULL) = (decided_at IS NULL)
      ),
      -- Only approval happens automatically; a rejection always has a reviewer.
      CONSTRAINT extraction_reviews_decided_by_matches_decision CHECK (
        (decided_by IS NULL OR decision IS NOT NULL) AND (decision <> 'rejected' OR decided_by IS NOT NULL)
      ),
      CONSTRAINT extraction_reviews_reason_only_when_rejected CHECK (
        reject_reason IS NULL OR decision = 'rejected'
      )
    )
  `.execute(db);
  await sql`
    CREATE TRIGGER extraction_reviews_set_updated_at BEFORE UPDATE ON extraction_reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
  // Same defense in depth as the initial schema: no access for Supabase's Data API roles.
  await sql`ALTER TABLE extraction_reviews ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE extraction_reviews`.execute(db);
  // Development only: the old constraint has no rejected status, and failed is the closest outcome.
  await sql`UPDATE documents SET status = 'failed' WHERE status = 'rejected'`.execute(db);
  await sql`
    ALTER TABLE documents
      DROP CONSTRAINT documents_status_check,
      ADD CONSTRAINT documents_status_check
        CHECK (status IN ('uploaded', 'queued', 'processing',
                          'needs_review', 'completed', 'failed')),
      DROP CONSTRAINT documents_processed_at_matches_status,
      ADD CONSTRAINT documents_processed_at_matches_status CHECK (
        (status IN ('needs_review', 'completed', 'failed')) = (processed_at IS NOT NULL)
      )
  `.execute(db);
}
