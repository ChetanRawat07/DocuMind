import { DOCUMENT_SORTS, type DocumentSort } from '@documind/shared';
import { z } from 'zod';
import {
  DOCUMENT_SORT_SPECS,
  type DocumentPageCursor,
  type DocumentSortColumn,
} from './documents.repository.js';

/** The sort value's shape for each sort column, as it appears in the cursor. */
const VALUE_SCHEMAS: Record<DocumentSortColumn, z.ZodType<Date | string | number>> = {
  created_at: z.iso.datetime().transform((iso) => new Date(iso)),
  original_filename: z.string().min(1).max(255),
  size_bytes: z.number().int().positive(),
};

const cursorSchema = z.object({
  sort: z.enum(DOCUMENT_SORTS),
  value: z.unknown(),
  id: z.uuid(),
});

/**
 * Opaque page cursor: base64url of the sort it belongs to, the last item's
 * sort value and its id. Clients must not build or inspect it, so the format
 * can change without breaking them. It needs no signature: a forged cursor
 * only moves the starting point within the caller's own documents, because
 * every query filters by owner.
 */
export function encodeDocumentCursor(sort: DocumentSort, cursor: DocumentPageCursor): string {
  const value = cursor.value instanceof Date ? cursor.value.toISOString() : cursor.value;
  return Buffer.from(JSON.stringify({ sort, value, id: cursor.id })).toString('base64url');
}

/**
 * Returns null for anything that is not a cursor this API produced for
 * `sort`. A cursor from another sort order would silently skip or repeat
 * rows, so it is refused rather than reinterpreted.
 */
export function decodeDocumentCursor(
  sort: DocumentSort,
  encoded: string,
): DocumentPageCursor | null {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const cursor = cursorSchema.safeParse(payload);
  if (!cursor.success || cursor.data.sort !== sort) return null;

  const value = VALUE_SCHEMAS[DOCUMENT_SORT_SPECS[sort].column].safeParse(cursor.data.value);
  return value.success ? { value: value.data, id: cursor.data.id } : null;
}
