import { type Kysely, sql } from 'kysely';

/*
 * Drops the unique index on lower(users.email).
 *
 * users is a lazily synced copy of Supabase Auth identities, keyed by the
 * Supabase user id. Supabase keeps emails unique among its live users, but our
 * copy can lag: a user who changed their email keeps the old one here until
 * their next request, and a user deleted in Supabase keeps their row. Either
 * case would make the unique index reject a legitimate new user who now owns
 * that address. Identity is the id, not the email, so the index goes.
 * No query looks users up by email, so no replacement index is needed.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX users_email_lower_key`.execute(db);
}

// Fails if case-insensitive duplicate emails exist by then; resolve those first.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email))`.execute(db);
}
