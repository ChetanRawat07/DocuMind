import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import type { Users } from '../database/generated/database.js';

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Identity as asserted by the authentication provider (Supabase Auth). */
export interface UserIdentity {
  /** The provider's stable user id (JWT `sub`). */
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly db: DatabaseExecutor) {}

  /**
   * Inserts the user unless the id already exists. Returns the new user, or
   * null when the row was already there, including when a concurrent request
   * inserted it first (ON CONFLICT waits for that transaction, then skips).
   */
  async createIfAbsent(identity: UserIdentity, executor = this.db): Promise<User | null> {
    const row = await executor
      .insertInto('users')
      .values({ id: identity.id, email: identity.email, display_name: identity.displayName })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .returningAll()
      .executeTakeFirst();
    return row ? toUser(row) : null;
  }

  /** Copies email and display name from the identity provider. Returns null if the user does not exist. */
  async updateProfile(identity: UserIdentity, executor = this.db): Promise<User | null> {
    const row = await executor
      .updateTable('users')
      .set({ email: identity.email, display_name: identity.displayName })
      .where('id', '=', identity.id)
      .returningAll()
      .executeTakeFirst();
    return row ? toUser(row) : null;
  }

  async findById(id: string, executor = this.db): Promise<User | null> {
    const row = await executor
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toUser(row) : null;
  }
}

function toUser(row: Selectable<Users>): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
