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
   * Creates the user on first sight and keeps email/display name in sync with
   * the identity provider afterwards. A single statement, so concurrent first
   * requests for the same user cannot create duplicates.
   */
  async upsertFromIdentity(identity: UserIdentity, executor = this.db): Promise<User> {
    const row = await executor
      .insertInto('users')
      .values({ id: identity.id, email: identity.email, display_name: identity.displayName })
      .onConflict((conflict) =>
        conflict.column('id').doUpdateSet((eb) => ({
          email: eb.ref('excluded.email'),
          display_name: eb.ref('excluded.display_name'),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toUser(row);
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
