# ADR-012: Kysely query builder with hand-written SQL migrations

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Phase 1 needs a data-access layer and migration tooling. Requirements from the plan and earlier
ADRs:

- Parameterized queries only, with compile-time types.
- First-class support for the Postgres features the design depends on: partial unique indexes,
  `INSERT … ON CONFLICT … WHERE`, `FOR UPDATE SKIP LOCKED`, row-value comparisons for keyset
  pagination, composite foreign keys, `CHECK` constraints and triggers.
- Explicit transactions spanning several repository calls.
- Compatibility with Supabase's transaction-mode pooler (Supavisor), which does not support
  prepared statements in transaction mode.
- The SQL must be easy to read and explain.

## Decision

- **Kysely 0.29** with the `pg` driver for queries. Repositories map snake_case rows to camelCase
  domain objects explicitly.
- **Migrations are TypeScript files containing raw SQL** written with Kysely's `sql` template tag,
  run by Kysely's `Migrator` from an explicit registry (`migrations/index.ts`) instead of a folder
  scan. Each has `up` and `down`. Applied through `npm run db:migrate` (`dist/database/migrate.js`).
- **Row types are generated** from the migrated database with `kysely-codegen` and committed;
  `db:codegen:check` detects drift.

## Alternatives

- **Drizzle ORM.** Schema in TypeScript with generated migrations; capable, but pre-1.0, and the
  generated SQL still needs careful review.
- **Prisma.** Partial unique indexes and `SKIP LOCKED` need raw SQL, and it uses named prepared
  statements by default, which conflict with Supavisor's transaction mode. At decision time its
  next major version was a release candidate.
- **Raw `pg` + node-pg-migrate.** Maximum transparency, but query results are untyped.
- **Kysely's `CamelCasePlugin` instead of explicit mapping.** It would also rename keys inside
  `jsonb` values (extraction field names) unless configured carefully, and it couples API shapes
  to column names.

## Trade-offs

- More code than an ORM: each repository writes its own mapping function.
- Generated types do not know `CHECK`-constrained values, so mappers cast statuses to their union
  types. A database test keeps the constraints and the shared constants in sync.
- Kysely is ESM-only; the CommonJS API loads it through Node's `require(esm)` (ADR-011).
- The registry must be updated by hand for each migration; a unit test enforces it.

## Consequences

- Every query compiles to visible, parameterized SQL that can be checked with `EXPLAIN`.
- No session state is relied on, so switching between a direct connection, session-mode pooling and
  transaction-mode pooling is a connection-string change.
