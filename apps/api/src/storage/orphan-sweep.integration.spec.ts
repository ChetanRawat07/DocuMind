import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertDocument, insertUser } from '../../test/support/factories.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { FilesystemStorage } from './filesystem-storage.js';
import { findOrphans, ORPHAN_MIN_AGE_MS } from './orphan-sweep.js';

const NOW = new Date('2026-11-04T12:00:00Z');
const OLD = new Date(NOW.getTime() - ORPHAN_MIN_AGE_MS - 60_000);
const RECENT = new Date(NOW.getTime() - 60_000);

async function orphanKeys(storage: FilesystemStorage, db: DatabaseExecutor): Promise<string[]> {
  const keys: string[] = [];
  for await (const orphan of findOrphans(storage, db, { now: NOW })) keys.push(orphan.key);
  return keys;
}

describe('findOrphans', () => {
  let db: DatabaseExecutor;
  let root: string;
  let storage: FilesystemStorage;

  const keyFor = (ownerId: string, documentId: string = randomUUID()) =>
    `documents/${ownerId}/2026/${documentId}/original.pdf`;

  async function store(key: string, modified: Date) {
    await storage.put(key, Buffer.from('%PDF-1.7'));
    await utimes(storage.pathFor(key), modified, modified);
  }

  beforeAll(() => {
    db = createTestDatabase();
  });
  afterAll(async () => {
    await db.destroy();
  });
  beforeEach(async () => {
    await truncateAllTables(db);
    root = await mkdtemp(join(tmpdir(), 'documind-sweep-test-'));
    storage = new FilesystemStorage(root);
    return () => rm(root, { recursive: true, force: true });
  });

  it('reports old objects without a row, never referenced or recent ones', async () => {
    const { id: ownerId } = await insertUser(db);
    const { id: documentId } = await insertDocument(db, ownerId);
    const referenced = keyFor(ownerId, documentId);
    const orphan = keyFor(ownerId);
    await store(referenced, OLD);
    await store(orphan, OLD);
    // An upload whose row is not committed yet looks just like this.
    await store(keyFor(ownerId), RECENT);
    // An interrupted filesystem write; not a key the application uses.
    await writeFile(`${storage.pathFor(orphan)}.${randomUUID()}.tmp`, 'partial');

    expect(await orphanKeys(storage, db)).toEqual([orphan]);
  });

  it('checks objects in batches larger than one query', async () => {
    const { id: ownerId } = await insertUser(db);
    const keys = Array.from({ length: 501 }, () => keyFor(ownerId));
    for (const key of keys) await store(key, OLD);

    expect((await orphanKeys(storage, db)).sort()).toEqual([...keys].sort());
  });

  it('finds nothing in an empty or missing storage root', async () => {
    await rm(root, { recursive: true, force: true });
    expect(await orphanKeys(storage, db)).toEqual([]);
  });
});
