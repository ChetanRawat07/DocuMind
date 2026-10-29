import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expectPgError, PG } from '../../test/support/postgres-errors.js';
import { createTestDatabase, truncateAllTables } from '../../test/support/test-database.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { UsersRepository } from './users.repository.js';

describe('UsersRepository', () => {
  let db: DatabaseExecutor;
  let users: UsersRepository;

  beforeAll(() => {
    db = createTestDatabase();
    users = new UsersRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  it('creates a user from an identity on first sight', async () => {
    const id = randomUUID();

    const user = await users.upsertFromIdentity({
      id,
      email: 'ada@example.test',
      displayName: 'Ada',
    });

    expect(user).toMatchObject({ id, email: 'ada@example.test', displayName: 'Ada' });
    expect(await users.findById(id)).toEqual(user);
  });

  it('syncs email and display name on later sign-ins without creating a duplicate', async () => {
    const id = randomUUID();
    await users.upsertFromIdentity({ id, email: 'ada@example.test', displayName: null });

    const updated = await users.upsertFromIdentity({
      id,
      email: 'ada.lovelace@example.test',
      displayName: 'Ada Lovelace',
    });

    expect(updated).toMatchObject({
      email: 'ada.lovelace@example.test',
      displayName: 'Ada Lovelace',
    });
    const count = await db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    expect(count.count).toBe('1');
  });

  it('handles concurrent first sign-ins for the same identity', async () => {
    const identity = { id: randomUUID(), email: 'ada@example.test', displayName: null };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => users.upsertFromIdentity(identity)),
    );

    expect(new Set(results.map((user) => user.id))).toEqual(new Set([identity.id]));
  });

  it('rejects an email already used by a different identity', async () => {
    await users.upsertFromIdentity({
      id: randomUUID(),
      email: 'ada@example.test',
      displayName: null,
    });

    await expectPgError(
      users.upsertFromIdentity({ id: randomUUID(), email: 'ADA@example.test', displayName: null }),
      { code: PG.uniqueViolation, constraint: 'users_email_lower_key' },
    );
  });

  it('returns null for an unknown user', async () => {
    expect(await users.findById(randomUUID())).toBeNull();
  });
});
