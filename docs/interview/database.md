# Database questions

[Back to interview preparation](README.md) · Full detail: [schema](../database/schema.md)

## Why these tables?

**Say:** Each table holds one kind of fact with one lifecycle:

| Table                                   | Holds                                                   | Why separate                                                              |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `users`                                 | A local copy of the Supabase identity                   | Documents need an owner to reference; credentials stay in Supabase        |
| `documents`                             | File metadata, user-facing status                       | The bytes are in object storage under `storage_key`                       |
| `processing_jobs`                       | The queue and the job history                           | A document can be processed several times; each attempt has its own state |
| `document_texts`, `document_text_pages` | Extracted text per page, with method and OCR confidence | Reused across retries and reprocessing; evidence checks need the page     |
| `document_extractions`                  | The model's output, one immutable version per job       | Reprocessing adds a version, never overwrites                             |
| `extraction_reviews`                    | A person's confirmations, corrections and decision      | Kept apart so the model's original output stays auditable                 |
| `audit_logs`                            | Append-only record of actions                           | No foreign keys, so history survives deletion of the user or document     |

The two status fields are deliberate: `documents.status` is what the user sees (`queued`,
`needs_review`, `completed`…), and `processing_jobs.status` is the queue's state machine
(`queued → running → succeeded | failed`).

**Follow-ups:**

- _Why `jsonb` for fields instead of a table per document type?_ The three types have different
  fields, and each value carries a confidence and a quote. A table per type, or an
  entity-attribute-value table, adds joins without adding integrity that Zod validation before
  insert doesn't already give. The cost: the database can't check the inner shape.
- _Why `text` plus `CHECK` instead of `ENUM` for statuses?_ A Postgres enum value can't be removed or
  renamed, and a new one can't be used in the transaction that adds it. A `CHECK` is replaced in one
  migration, and a test keeps its literals equal to the shared TypeScript constants.
- _Why UUIDs?_ Ids appear in URLs; random UUIDs can't be guessed or enumerated. The audit log uses a
  `bigint` identity instead: it's never exposed as a lookup key, and it's an exact, increasing
  cursor.

## Why these indexes?

**Say:** Every index serves a query that runs often, and almost every one starts with `user_id`,
because every user-facing query is scoped to one user. That keeps cost proportional to one user's
data, not the whole table. Two queue indexes are partial: they contain only queued or running jobs,
so they stay small however long the job history grows.

| Index                                                   | Serves                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `documents (user_id, created_at, id)`                   | The document list, newest or oldest first, keyset-paged             |
| `documents (user_id, status)`                           | Status filters and counts                                           |
| `documents (user_id, processed_at)` partial             | The analytics window                                                |
| `processing_jobs (available_at)` where `queued`         | The worker's claim                                                  |
| `processing_jobs (lease_expires_at)` where `running`    | Recovering crashed workers' jobs                                    |
| `processing_jobs (document_id)` unique where active     | At most one active job per document (an invariant, not only speed)  |
| `processing_jobs (user_id, created_at, id)`             | A user's jobs, newest first                                         |
| `processing_jobs (user_id, finished_at)`                | The processing summary: active jobs and jobs finished in the window |
| `document_extractions (document_id, created_at, id)`    | The latest extraction of a document                                 |
| `audit_logs (resource…)`, `(actor_user_id, id)` partial | A document's timeline, a user's audit log                           |
| `audit_logs` partial on upload and reprocess actions    | The daily processing quota                                          |
| `extraction_reviews (decided_by)`                       | The foreign-key check when a user is deleted                        |

**Evidence:** the query and index tables in [schema](../database/schema.md#tables), and the plans
in the [performance review](../operations/performance-review.md).

**Follow-ups:**

- _How did you find the missing ones?_ At 1 million documents, with `auto_explain` logging the real
  plan of every query over 20 ms. The processing summary scanned every job of every user because
  jobs had no owner column: 534 ms for the largest account. Adding `user_id` to jobs, with a
  composite foreign key so it always equals the document's owner, and two indexes made it 31 ms
  ([ADR-020](../adr/020-job-owner-and-jit.md)).
- _Isn't that denormalization risky?_ It would be without the constraint. The foreign key
  `(document_id, user_id) → documents (id, user_id)` makes a mismatched copy impossible, and a test
  checks it.
- _What doesn't have an index?_ Filename substring search (`ILIKE '%term%'`). It scans one user's
  documents through a `user_id` index, which is fine at hundreds or thousands of documents per user.
  A trigram index (`pg_trgm`) is the fix for very large accounts.

## Which queries are frequent?

**Say:** In order of volume:

1. **User lookup by id** on every authenticated request, a primary-key read. Provisioning writes
   only when the user is new or their email changed.
2. **The worker's poll**, every 5 s when idle, a claim through the small partial index.
3. **The document list**: `WHERE user_id = $1 AND (created_at, id) < ($cursor) ORDER BY created_at
DESC, id DESC LIMIT 21`. Keyset pagination keeps every page as fast as the first: 4–5 ms at 1
   million documents.
4. **One document, its jobs, its extraction**, all primary-key or `document_id` lookups, always with
   the owner in the `WHERE` clause.
5. **The processing summary and analytics**, the heaviest, bounded by a time window and the user.

**Follow-ups:**

- _Why keyset and not `OFFSET`?_ `OFFSET n` reads and throws away `n` rows, so late pages get slower,
  and rows added between requests shift pages (duplicates or gaps). A keyset cursor uses the index
  directly. The cursor is opaque to the client and includes `id` to break ties.
- _Why `timestamptz(3)` on `created_at`?_ The cursor round-trips through a JavaScript `Date`, which
  has millisecond precision. With microseconds the cursor wouldn't match the stored value.

## Where are transactions needed?

**Say:** Wherever two writes must both happen or neither:

| Operation                                                   | Why                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Create document + enqueue job + audit entry                 | Removes the dual-write problem: no document without a job, no job without a document |
| Store extraction + mark job succeeded + set document status | A crash in between can't leave a succeeded job with no result, or the reverse        |
| Review action: lock document, write review, status, audit   | The row lock serializes concurrent reviewers; status and decision change together    |
| Erase user: lock user, delete documents, audit, delete user | An upload in flight either commits first or fails on the missing user                |
| Provision user + `user.registered` audit entry              | Every account created is recorded, and only those                                    |

Single-statement upserts don't need one; one statement is already atomic.

**Follow-ups:**

- _Which isolation level?_ The default, `READ COMMITTED`. The invariants rely on unique constraints
  and row locks, not on `SERIALIZABLE`, which would need retry loops everywhere.
- _What about the file in object storage?_ It can't join a database transaction. The order is chosen
  so a failure leaves at worst an unreferenced file (upload: file first; delete: row first), which
  the sweep finds.

## How is idempotency enforced?

**Say:** At every layer where a repeat can happen, by the database where possible:

- **Duplicate enqueue:** a partial unique index allows one queued or running job per document.
  `INSERT … ON CONFLICT DO NOTHING` returns the existing job; ten concurrent requests produce
  exactly one (tested).
- **Reprocess request:** `POST /documents/:id/jobs` returns the active job if there is one, and
  doesn't count against the quota again.
- **Retried job after a crash:** `UNIQUE (job_id)` on extractions, so a retry after "stored but not
  yet marked succeeded" returns the stored row. Extracted text is reused if it already exists.
- **A worker that lost its job:** every write after the claim is fenced with
  `status = 'running' AND attempts = <its attempt>`, so a stale worker's writes match nothing.
- **First request of a new user:** `INSERT … ON CONFLICT (id) DO NOTHING`; eight concurrent first
  requests create one user and one audit entry (tested).
- **Review decisions:** applied only `WHERE decision IS NULL`, and each request names the
  extraction it was made against, so a decision can't land on a newer result.

**Evidence:** [ADR-008](../adr/008-retry-and-idempotency.md),
[schema invariants](../database/schema.md#processing_jobs).

**Follow-ups:**

- _Why not idempotency keys on the HTTP API?_ The natural keys already make the operations
  idempotent: one active job per document, one extraction per job. A client-supplied key would add a
  table without closing a gap. An upload repeated by the client does create a second document;
  that's intended, since users may upload the same file twice.
