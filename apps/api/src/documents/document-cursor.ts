import { z } from 'zod';
import type { DocumentPageCursor } from './documents.repository.js';

const cursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

/**
 * Opaque page cursor: base64url of the last item's (createdAt, id). Clients
 * must not build or inspect it, so the format can change without breaking
 * them. It needs no signature: a forged cursor only moves the starting point
 * within the caller's own documents, because every query filters by owner.
 */
export function encodeDocumentCursor(cursor: DocumentPageCursor): string {
  const payload = { createdAt: cursor.createdAt.toISOString(), id: cursor.id };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/** Returns null for anything that is not a cursor this API produced. */
export function decodeDocumentCursor(encoded: string): DocumentPageCursor | null {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const result = cursorSchema.safeParse(payload);
  return result.success ? { createdAt: new Date(result.data.createdAt), id: result.data.id } : null;
}
