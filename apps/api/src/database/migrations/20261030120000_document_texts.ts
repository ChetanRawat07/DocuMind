import { type Kysely, sql } from 'kysely';

/*
 * Text extracted from a document (Phase 6): a summary row per document and
 * one row per page, saying whether the text came from the PDF's text layer
 * or from OCR. See docs/processing/text-extraction.md.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  // One row per document; replaced as a whole when extraction runs again.
  await sql`
    CREATE TABLE document_texts (
      document_id     uuid        PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
      page_count      integer     NOT NULL CHECK (page_count >= 1),
      ocr_page_count  integer     NOT NULL CHECK (ocr_page_count BETWEEN 0 AND page_count),
      character_count integer     NOT NULL CHECK (character_count >= 0),
      duration_ms     integer     NOT NULL CHECK (duration_ms >= 0),
      engine          text        NOT NULL CHECK (char_length(engine) BETWEEN 1 AND 200),
      extracted_at    timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE document_text_pages (
      document_id    uuid             NOT NULL REFERENCES document_texts (document_id) ON DELETE CASCADE,
      page_number    integer          NOT NULL CHECK (page_number >= 1),
      method         text             NOT NULL CHECK (method IN ('text_layer', 'ocr')),
      text           text             NOT NULL CHECK (char_length(text) <= 100000),
      ocr_confidence double precision CHECK (ocr_confidence BETWEEN 0 AND 1),
      PRIMARY KEY (document_id, page_number),
      -- OCR pages always carry a confidence; text-layer pages never do.
      CONSTRAINT document_text_pages_confidence_matches_method CHECK (
        (method = 'ocr') = (ocr_confidence IS NOT NULL)
      )
    )
  `.execute(db);

  // Same defense in depth as the initial schema: no access for Supabase's Data API roles.
  await sql`ALTER TABLE document_texts ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE document_text_pages ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE document_text_pages`.execute(db);
  await sql`DROP TABLE document_texts`.execute(db);
}
