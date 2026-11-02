import { type Kysely, sql } from 'kysely';

/*
 * Phase 8: what an extraction needs beyond its fields to be reviewed and
 * traced. See docs/processing/document-extraction.md.
 *
 * The columns are NOT NULL without a default on purpose: the migration fails
 * on existing rows instead of inventing a confidence or prompt for them.
 * Before Phase 8 only the development seed wrote extractions, so a
 * development database is rebuilt instead (`npm run db:reset`, `db:migrate`,
 * `db:seed`). Production has none: no worker has run there.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE document_extractions
      ADD COLUMN classification_confidence double precision NOT NULL
        CHECK (classification_confidence BETWEEN 0 AND 1),
      -- Business-rule and evidence findings for review; codes and field names, never values.
      ADD COLUMN validation_issues jsonb NOT NULL
        CHECK (jsonb_typeof(validation_issues) = 'array'),
      -- "template-id@version" of each prompt that produced the result.
      ADD COLUMN classification_prompt text NOT NULL
        CHECK (char_length(classification_prompt) BETWEEN 1 AND 100),
      ADD COLUMN extraction_prompt text NOT NULL
        CHECK (char_length(extraction_prompt) BETWEEN 1 AND 100)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE document_extractions
      DROP COLUMN extraction_prompt,
      DROP COLUMN classification_prompt,
      DROP COLUMN validation_issues,
      DROP COLUMN classification_confidence
  `.execute(db);
}
