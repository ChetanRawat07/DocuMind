import { type Kysely, sql } from 'kysely';

/*
 * Initial DocuMind schema. See docs/database/schema.md for the reasoning behind
 * every table, constraint and index.
 *
 * Allowed values (statuses, types) are written as literals on purpose: a
 * migration is a frozen snapshot and must not change meaning when application
 * constants change later. A database test checks they match the shared constants.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  // Keeps updated_at correct no matter which code path writes the row.
  await sql`
    CREATE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$
  `.execute(db);

  await sql`
    CREATE FUNCTION reject_update() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END;
    $$
  `.execute(db);

  // Users: the application-side identity. id is the Supabase Auth user id
  // (JWT "sub"), so it has no default. No FK to Supabase's auth schema keeps
  // local development and tests independent of Supabase.
  await sql`
    CREATE TABLE users (
      id           uuid        PRIMARY KEY,
      email        text        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
      display_name text        CHECK (char_length(display_name) BETWEEN 1 AND 100),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email))`.execute(db);
  await sql`
    CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);

  // Documents: metadata only; file bytes live in object storage under storage_key.
  // ON DELETE RESTRICT: a user cannot be removed while documents (and their
  // stored objects) exist, so account deletion must clean up storage first.
  await sql`
    CREATE TABLE documents (
      id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
      original_filename text        NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
      mime_type         text        NOT NULL CHECK (char_length(mime_type) BETWEEN 3 AND 255),
      size_bytes        integer     NOT NULL CHECK (size_bytes > 0),
      storage_key       text        NOT NULL UNIQUE CHECK (char_length(storage_key) BETWEEN 1 AND 1024),
      document_type     text        CHECK (document_type IN ('invoice', 'contract', 'purchase_order')),
      status            text        NOT NULL DEFAULT 'uploaded'
                                    CHECK (status IN ('uploaded', 'queued', 'processing',
                                                      'needs_review', 'completed', 'failed')),
      processed_at      timestamptz,
      -- Millisecond precision: created_at is part of the pagination cursor and
      -- must round-trip exactly through a JavaScript Date (which has no microseconds).
      created_at        timestamptz(3) NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT documents_processed_at_matches_status CHECK (
        (status IN ('needs_review', 'completed', 'failed')) = (processed_at IS NOT NULL)
      )
    )
  `.execute(db);
  // Serves the owner's document list (newest first, keyset pagination) and the
  // FK check when a user row is deleted.
  await sql`
    CREATE INDEX documents_user_id_created_at_id_idx
    ON documents (user_id, created_at DESC, id DESC)
  `.execute(db);
  // Serves per-owner status filters and dashboard counts.
  await sql`CREATE INDEX documents_user_id_status_idx ON documents (user_id, status)`.execute(db);
  await sql`
    CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);

  // Processing jobs: the durable queue (ADR-005) and the job history.
  await sql`
    CREATE TABLE processing_jobs (
      id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id        uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
      status             text        NOT NULL DEFAULT 'queued'
                                     CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
      stage              text        CHECK (stage IN ('text_extraction', 'ocr', 'classification',
                                                    'ai_extraction', 'validation',
                                                    'confidence_evaluation')),
      attempts           integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      max_attempts       integer     NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
      available_at       timestamptz NOT NULL DEFAULT now(),
      locked_by          text        CHECK (char_length(locked_by) BETWEEN 1 AND 200),
      locked_at          timestamptz,
      lease_expires_at   timestamptz,
      last_error_code    text        CHECK (char_length(last_error_code) BETWEEN 1 AND 100),
      last_error_message text        CHECK (char_length(last_error_message) <= 2000),
      started_at         timestamptz,
      finished_at        timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT processing_jobs_attempts_within_max CHECK (attempts <= max_attempts),
      CONSTRAINT processing_jobs_lease_matches_status CHECK (
        (status = 'running'
          AND locked_by IS NOT NULL AND locked_at IS NOT NULL
          AND lease_expires_at IS NOT NULL AND lease_expires_at > locked_at)
        OR
        (status <> 'running'
          AND locked_by IS NULL AND locked_at IS NULL AND lease_expires_at IS NULL)
      ),
      CONSTRAINT processing_jobs_finished_at_matches_status CHECK (
        (status IN ('succeeded', 'failed')) = (finished_at IS NOT NULL)
      ),
      -- Target of the composite FK from document_extractions.
      CONSTRAINT processing_jobs_id_document_id_key UNIQUE (id, document_id)
    )
  `.execute(db);
  // Idempotency: at most one queued or running job per document, enforced by
  // the database so concurrent or duplicate enqueue requests cannot both win.
  await sql`
    CREATE UNIQUE INDEX processing_jobs_one_active_per_document_key
    ON processing_jobs (document_id) WHERE status IN ('queued', 'running')
  `.execute(db);
  // Serves the worker's claim query: oldest available queued job first.
  await sql`
    CREATE INDEX processing_jobs_claimable_idx
    ON processing_jobs (available_at) WHERE status = 'queued'
  `.execute(db);
  // Serves stale-job recovery: running jobs whose lease has expired.
  await sql`
    CREATE INDEX processing_jobs_running_lease_idx
    ON processing_jobs (lease_expires_at) WHERE status = 'running'
  `.execute(db);
  // Serves a document's job history and the FK cascade from documents.
  await sql`
    CREATE INDEX processing_jobs_document_id_created_at_idx
    ON processing_jobs (document_id, created_at DESC)
  `.execute(db);
  await sql`
    CREATE TRIGGER processing_jobs_set_updated_at BEFORE UPDATE ON processing_jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);

  // Document extractions: validated AI output, one immutable version per successful job.
  await sql`
    CREATE TABLE document_extractions (
      id                 uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id        uuid             NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
      job_id             uuid             NOT NULL,
      document_type      text             NOT NULL
                                          CHECK (document_type IN ('invoice', 'contract', 'purchase_order')),
      schema_version     integer          NOT NULL CHECK (schema_version >= 1),
      fields             jsonb            NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
      overall_confidence double precision NOT NULL CHECK (overall_confidence BETWEEN 0 AND 1),
      ai_provider        text             NOT NULL CHECK (char_length(ai_provider) BETWEEN 1 AND 50),
      ai_model           text             NOT NULL CHECK (char_length(ai_model) BETWEEN 1 AND 200),
      created_at         timestamptz      NOT NULL DEFAULT now(),
      -- One extraction per job: a retried "persist result" step cannot insert twice.
      CONSTRAINT document_extractions_job_id_key UNIQUE (job_id),
      -- The job must belong to the same document as the extraction.
      CONSTRAINT document_extractions_job_document_fkey
        FOREIGN KEY (job_id, document_id)
        REFERENCES processing_jobs (id, document_id) ON DELETE CASCADE
    )
  `.execute(db);
  // Serves "latest extraction for a document".
  await sql`
    CREATE INDEX document_extractions_document_id_created_at_id_idx
    ON document_extractions (document_id, created_at DESC, id DESC)
  `.execute(db);

  // Audit logs: append-only history. actor_user_id and resource_id carry no FK
  // on purpose, so the history survives deletion of the user or resource.
  await sql`
    CREATE TABLE audit_logs (
      id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      occurred_at   timestamptz NOT NULL DEFAULT now(),
      actor_type    text        NOT NULL CHECK (actor_type IN ('user', 'system')),
      actor_user_id uuid,
      action        text        NOT NULL CHECK (action ~ '^[a-z][a-z_]*\\.[a-z][a-z_]*$'),
      resource_type text        NOT NULL CHECK (resource_type ~ '^[a-z][a-z_]*$'),
      resource_id   uuid,
      request_id    text        CHECK (char_length(request_id) BETWEEN 1 AND 100),
      metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
      CONSTRAINT audit_logs_actor_matches_type CHECK (
        (actor_type = 'user') = (actor_user_id IS NOT NULL)
      )
    )
  `.execute(db);
  // Serves a user's activity history.
  await sql`
    CREATE INDEX audit_logs_actor_user_id_occurred_at_idx
    ON audit_logs (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL
  `.execute(db);
  // Serves a resource's timeline (for example, everything that happened to a document).
  await sql`
    CREATE INDEX audit_logs_resource_occurred_at_id_idx
    ON audit_logs (resource_type, resource_id, occurred_at DESC, id DESC)
  `.execute(db);
  // Entries are immutable. DELETE stays allowed so retention can purge old entries.
  await sql`
    CREATE TRIGGER audit_logs_reject_update BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION reject_update()
  `.execute(db);

  // Defense in depth: row-level security with no policies denies every role
  // except the table owner (which the API, worker and migrations connect as).
  // On Supabase this closes the auto-generated Data API, which would otherwise
  // expose public-schema tables to anyone holding the public anon key.
  for (const table of [
    'users',
    'documents',
    'processing_jobs',
    'document_extractions',
    'audit_logs',
  ]) {
    await sql`ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE audit_logs`.execute(db);
  await sql`DROP TABLE document_extractions`.execute(db);
  await sql`DROP TABLE processing_jobs`.execute(db);
  await sql`DROP TABLE documents`.execute(db);
  await sql`DROP TABLE users`.execute(db);
  await sql`DROP FUNCTION reject_update()`.execute(db);
  await sql`DROP FUNCTION set_updated_at()`.execute(db);
}
