import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrations } from './index.js';

const MIGRATION_FILE = /^(\d{14}_[a-z0-9_]+)\.ts$/;

describe('migration registry', () => {
  it('registers every migration file, in timestamp order', () => {
    const fileNames = readdirSync(__dirname)
      .map((file) => MIGRATION_FILE.exec(file)?.[1])
      .filter((name): name is string => name !== undefined)
      .sort();

    expect(Object.keys(migrations)).toEqual(fileNames);
  });
});
