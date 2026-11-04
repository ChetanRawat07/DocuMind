# ADR-020: Job owner column and JIT off

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

Phase 15 measured the API against 1 million documents and jobs
([performance review](../operations/performance-review.md)).

- **Jobs had no owner column.** The Processing summary and job list reached a user's jobs only
  through `documents`, and PostgreSQL answered both by hashing every job in the table: 220–534 ms
  at 1 million jobs. That cost grows with all users' traffic, not with the viewer's.
- **JIT compilation cost more than it saved.** It took 15% of the time of slow queries, and it is
  triggered by cost estimates, so it hit the largest accounts hardest. Upstream PostgreSQL has
  since made it off by default.
- **The pooler drops session settings.** Supabase's transaction-mode pooler does not keep
  session-level settings between transactions.

## Decision

- **Owner on jobs:**
  - `processing_jobs.user_id` holds the document's owner. `enqueue` fills it from the document in
    the same statement.
  - A composite foreign key `(document_id, user_id) → documents (id, user_id) ON DELETE CASCADE`
    replaces the plain one, so the copy can never differ from the owner.
  - Indexes `(user_id, created_at DESC, id DESC)` for the list and `(user_id, finished_at)` for the
    summary. Active jobs have no `finished_at`, so one index serves both halves of the summary.
- **JIT off:** a migration runs `ALTER ROLE CURRENT_USER SET jit = off`. Any role may set its own
  defaults, and a role setting applies to every new connection, so it holds through the pooler.

## Alternatives

- **Rewrite the queries without a new column.** The summary could start from the user's recently
  processed documents. The newest-first job list could not be bounded that way: it would still
  read the user's whole job history, or give approximate results.
- **A trigger that copies the owner.** Hidden behaviour, and the generated row types would still
  require the column on insert. An explicit value checked by a foreign key is clearer.
- **JIT as a connection startup parameter (`options=-c jit=off`).** Not known to pass through
  Supavisor; a wrong guess fails every connection.
- **Raise `jit_above_cost` instead.** Keeps the cliff, only moves it.

## Trade-offs

- The owner is stored twice. Documents never change owner, and the foreign key enforces equality.
- Each job insert writes two more index entries.
- The role setting applies to every database that role uses, including local test databases.
- The migration's backfill rewrote the jobs table under an exclusive lock: 37 s for 1 million rows.
  That's fine for the demo's data. A large table would need a batched, online migration.

## Consequences

- The Processing summary and job list are bounded by the user's own recent jobs: 5–31 ms for the
  largest measured account.
- Every direct insert into `processing_jobs` (seed, test factories) supplies `user_id`.
- CI checks `SHOW jit` in the production image; the first real deploy checks it through the Supabase
  pooler ([deployment smoke test](../operations/deployment.md#after-every-deploy-smoke-test)).
