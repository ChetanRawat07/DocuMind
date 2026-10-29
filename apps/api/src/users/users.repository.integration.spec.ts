import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

    const user = await users.createIfAbsent({ id, email: 'ada@example.test', displayName: 'Ada' });

    expect(user).toMatchObject({ id, email: 'ada@example.test', displayName: 'Ada' });
    expect(await users.findById(id)).toEqual(user);
  });

  it('returns null instead of overwriting an existing user', async () => {
    const id = randomUUID();
    await users.createIfAbsent({ id, email: 'ada@example.test', displayName: null });

    const second = await users.createIfAbsent({
      id,
      email: 'other@example.test',
      displayName: null,
    });

    expect(second).toBeNull();
    expect((await users.findById(id))?.email).toBe('ada@example.test');
  });

  it('creates exactly one row under concurrent first requests', async () => {
    const identity = { id: randomUUID(), email: 'ada@example.test', displayName: null };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => users.createIfAbsent(identity)),
    );

    expect(results.filter((user) => user !== null)).toHaveLength(1);
    const count = await db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    expect(count.count).toBe('1');
  });

  it('updates email and display name from the identity provider', async () => {
    const id = randomUUID();
    await users.createIfAbsent({ id, email: 'ada@example.test', displayName: null });

    const updated = await users.updateProfile({
      id,
      email: 'ada.lovelace@example.test',
      displayName: 'Ada Lovelace',
    });

    expect(updated).toMatchObject({
      id,
      email: 'ada.lovelace@example.test',
      displayName: 'Ada Lovelace',
    });
  });

  it('returns null when updating a user that does not exist', async () => {
    expect(
      await users.updateProfile({ id: randomUUID(), email: 'ada@example.test', displayName: null }),
    ).toBeNull();
  });

  it('returns null for an unknown user', async () => {
    expect(await users.findById(randomUUID())).toBeNull();
  });
});
