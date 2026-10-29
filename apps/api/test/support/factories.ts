import { randomUUID } from 'node:crypto';
import type { DatabaseExecutor } from '../../src/database/database.types.js';

/** Minimal valid rows for tests. Overrides are spread last so a test controls what it asserts on. */

export async function insertUser(
  db: DatabaseExecutor,
  overrides: { id?: string; email?: string } = {},
): Promise<{ id: string; email: string }> {
  const id = overrides.id ?? randomUUID();
  const email = overrides.email ?? `user-${id}@example.test`;
  await db.insertInto('users').values({ id, email }).execute();
  return { id, email };
}

export async function insertDocument(
  db: DatabaseExecutor,
  ownerId: string,
  overrides: { id?: string; createdAt?: Date } = {},
): Promise<{ id: string }> {
  const id = overrides.id ?? randomUUID();
  await db
    .insertInto('documents')
    .values({
      id,
      user_id: ownerId,
      original_filename: 'sample.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      storage_key: `documents/${ownerId}/2026/${id}/original.pdf`,
      ...(overrides.createdAt ? { created_at: overrides.createdAt } : {}),
    })
    .execute();
  return { id };
}

export async function insertJob(
  db: DatabaseExecutor,
  documentId: string,
  status: 'queued' | 'succeeded' = 'queued',
): Promise<{ id: string }> {
  const row = await db
    .insertInto('processing_jobs')
    .values({
      document_id: documentId,
      status,
      ...(status === 'succeeded' ? { finished_at: new Date(), attempts: 1 } : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id };
}
