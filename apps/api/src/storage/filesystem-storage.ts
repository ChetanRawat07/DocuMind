import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { ObjectStorage } from './object-storage.js';
import { assertStorageKey } from './storage-key.js';

/**
 * Stores objects as files under `root`. For development and tests only: the
 * configuration refuses it in production, where hosts have ephemeral disks.
 */
export class FilesystemStorage extends ObjectStorage {
  constructor(private readonly root: string) {
    super();
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    // Write to a temporary file, then rename: readers never see a partial file.
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Absolute file path for a key; never outside `root`. */
  pathFor(key: string): string {
    assertStorageKey(key);
    const root = resolve(this.root);
    const path = resolve(root, key);
    const fromRoot = relative(root, path);
    if (fromRoot.startsWith('..') || fromRoot.startsWith(sep) || fromRoot === '') {
      throw new Error('Refusing a storage key outside the storage root');
    }
    return path;
  }
}
