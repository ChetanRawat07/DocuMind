import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemStorage } from './filesystem-storage.js';
import { ObjectNotFoundError } from './object-storage.js';

const KEY =
  'documents/6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607/2026/0a1b2c3d-4e5f-4a6b-8c7d-8e9fa0b1c2d3/original.pdf';

describe('FilesystemStorage', () => {
  let root: string;
  let storage: FilesystemStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'documind-storage-'));
    storage = new FilesystemStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores an object under the root at its key, readable only by the owner', async () => {
    await storage.put(KEY, Buffer.from('%PDF-1.7'));

    const path = join(root, KEY);
    expect(await readFile(path, 'utf8')).toBe('%PDF-1.7');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('replaces an existing object and leaves no temporary files', async () => {
    await storage.put(KEY, Buffer.from('first'));
    await storage.put(KEY, Buffer.from('second'));

    const directory = join(root, KEY, '..');
    expect(await readdir(directory)).toEqual(['original.pdf']);
    expect(await readFile(join(root, KEY), 'utf8')).toBe('second');
  });

  it('opens a stored object as a stream with its size', async () => {
    await storage.put(KEY, Buffer.from('%PDF-1.7'));

    const object = await storage.get(KEY);

    expect(object.size).toBe(8);
    expect(await text(object.body)).toBe('%PDF-1.7');
  });

  it('reports a missing object as ObjectNotFoundError before streaming', async () => {
    await expect(storage.get(KEY)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('deletes an object, and deleting a missing object succeeds', async () => {
    await storage.put(KEY, Buffer.from('x'));

    await storage.delete(KEY);
    await storage.delete(KEY);

    await expect(stat(join(root, KEY))).rejects.toThrow(/ENOENT/);
  });

  it.each(['../outside.pdf', `${KEY}/../../../../../../escape.pdf`, '/etc/passwd'])(
    'refuses key %j',
    async (key) => {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow(
        'Refusing an unexpected storage key',
      );
      await expect(storage.delete(key)).rejects.toThrow('Refusing an unexpected storage key');
      await expect(storage.get(key)).rejects.toThrow('Refusing an unexpected storage key');
    },
  );
});
