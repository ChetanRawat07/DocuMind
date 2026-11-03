import type { DatabaseExecutor } from '../database/database.types.js';
import type { ListedObject, ObjectStorage } from './object-storage.js';

/** Younger objects may belong to an upload whose row is not committed yet. */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const BATCH_SIZE = 500;

/**
 * Stored objects no document row references, older than `minAgeMs`. Only
 * rows grant access to a file, so an orphan is wasted storage, never a leak.
 * Uploads write the object before the row, so a young object without a row
 * is normal and is never reported.
 */
export async function* findOrphans(
  storage: ObjectStorage,
  db: DatabaseExecutor,
  { now = new Date(), minAgeMs = ORPHAN_MIN_AGE_MS } = {},
): AsyncIterable<ListedObject> {
  const cutoff = now.getTime() - minAgeMs;
  let batch: ListedObject[] = [];

  async function* unreferenced(objects: ListedObject[]): AsyncIterable<ListedObject> {
    const rows = await db
      .selectFrom('documents')
      .select('storage_key')
      .where(
        'storage_key',
        'in',
        objects.map((object) => object.key),
      )
      .execute();
    const referenced = new Set(rows.map((row) => row.storage_key));
    yield* objects.filter((object) => !referenced.has(object.key));
  }

  for await (const object of storage.list()) {
    if (object.lastModified.getTime() > cutoff) continue;
    batch.push(object);
    if (batch.length === BATCH_SIZE) {
      yield* unreferenced(batch);
      batch = [];
    }
  }
  if (batch.length > 0) yield* unreferenced(batch);
}
