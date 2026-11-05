# Architecture questions

[Back to interview preparation](README.md)

## Why a modular monolith?

**Say:** One NestJS codebase with two entrypoints: `main.ts` runs the HTTP API and `worker.ts` runs
the background worker. Both import the same feature modules (repositories, storage, text
extraction, AI), so there's one place for each piece of logic and one deploy. I get the property
that matters, separating slow processing from request handling, without network calls between
services, distributed tracing or a deploy per service. The module boundaries are enforced by
convention: feature modules never import HTTP code, which is what lets the worker load them.

**Evidence:** [ADR-001](../adr/001-modular-monolith.md); `apps/api/src/app.module.ts` and
`worker/worker.module.ts` both import `SHARED_FEATURE_MODULES`.

**Follow-ups:**

- _When would you split it?_ When parts need different scaling or release cadences, or separate
  teams own them. The first candidate is OCR: it's CPU-bound and could become its own worker pool
  without changing the queue.
- _How do you keep boundaries from eroding?_ Controllers live only in `*-http.module.ts` files
  imported by `AppModule`; only repositories touch the database; the worker module has no HTTP
  imports. These are written rules in `CONTRIBUTING.md`, and a lint rule could enforce them.
- _What did the free host change?_ Render's free plan has no background workers, so the worker runs
  inside the API process there (`WORKER_IN_PROCESS=true`). Because it's one codebase, that's a
  config flag, not a different build ([ADR-009](../adr/009-zero-cost-deployment.md)).

## Why PostgreSQL?

**Say:** The data is relational and integrity matters: documents belong to users, jobs and
extractions belong to documents, and several invariants are enforced by the database itself (one
active job per document, a job's owner equals its document's owner, an audit log that rejects
updates). I need multi-row transactions, for example storing an extraction and completing its job
together. `jsonb` covers the one flexible part, the extracted fields, which differ per document
type. And PostgreSQL also serves as the job queue, so there's one stateful service to run.

**Evidence:** [ADR-002](../adr/002-postgresql-system-of-record.md),
[schema](../database/schema.md).

**Follow-ups:**

- _Why not MongoDB for the extraction JSON?_ Only one column is document-shaped; everything around
  it is relational and transactional. `jsonb` plus Zod validation before insert gives the
  flexibility without giving up foreign keys.
- _Why Kysely and not an ORM?_ Type-safe SQL I can read and `EXPLAIN`, generated row types from the
  real schema, and plain SQL migrations ([ADR-012](../adr/012-kysely-and-sql-migrations.md)).

## Why Cloudflare R2 (why object storage)?

**Say:** Documents are binary files up to 10 MiB. In the database they would bloat backups and the
500 MB free quota, and every download would hold a database connection. Object storage is made for
this: cheap, durable, and the database keeps only metadata and a generated key. R2 specifically
because it's S3-compatible, so the code uses the standard AWS SDK and could move to S3 or MinIO
by changing an endpoint, and because it has a free tier and no egress fees.

**Evidence:** [ADR-003](../adr/003-object-storage-for-documents.md),
`apps/api/src/storage/` (an `ObjectStorage` port with filesystem and S3 adapters).

**Follow-ups:**

- _How do you keep the database and storage consistent?_ Upload writes the file first, then the
  row in a transaction; if the transaction fails the file is deleted. Delete removes the row first,
  then the file. Anything left behind is an unreferenced file, never a row without a file, and
  `npm run storage:sweep` lists those ([uploads](../storage/document-uploads.md)).
- _Why not presigned URLs?_ Files stream through the API so every read is ownership-checked and
  audited, and there's no bearer URL that can leak through logs or browser history
  ([ADR-016](../adr/016-file-access-through-the-api.md)). Presigned URLs become worth it if
  bandwidth through the API becomes a cost.
- _How are keys built?_ Only from generated ids: `documents/{userId}/{year}/{documentId}/original.pdf`.
  A user's filename never becomes part of a path.

## Why asynchronous processing?

**Say:** Processing takes seconds to minutes: OCR is CPU-heavy, and an AI call on CPU can take a
minute. Inside the upload request that would hit platform timeouts, hold connections, lose the work
if the client disconnects, and leave no way to retry. So the request does only the fast, certain
part (validate, store, record, enqueue) and returns `201` with the document already `queued`. The
worker does the slow part with retries, and the client follows progress through the status APIs.

**Evidence:** [ADR-004](../adr/004-asynchronous-document-processing.md),
`DocumentsService.upload`.

**Follow-ups:**

- _Why not fire off a promise in the API process?_ It's lost on a crash or redeploy, with no record
  it ever started, and nothing retries it.
- _How does the user see progress?_ Document status and job status endpoints, and the Processing
  page. The web app doesn't push updates yet; that's a known gap.

## Why a queue, and why in PostgreSQL?

**Say:** The queue makes the work durable and decouples the request from processing. I put it in
PostgreSQL rather than RabbitMQ for two reasons. First, the dual-write problem: creating the
document row and publishing a message are two systems, so one can succeed without the other.
Fixing that needs an outbox table, which is a PostgreSQL queue anyway. With the job as a row,
enqueueing is in the same transaction as the document. Second, cost and operations: no broker to
host for free, and the same mechanism locally and in production. Workers claim jobs with
`FOR UPDATE SKIP LOCKED`, so they never get the same job or wait on each other.

**Evidence:** [ADR-005](../adr/005-postgresql-job-queue.md),
[job queue](../processing/job-queue.md#claiming-and-fencing).

**Follow-ups:**

- _Doesn't polling hurt the database?_ An empty poll is one index lookup on a small partial index
  (only queued jobs). Measured: 1,625 claims a second with 16 workers, against 1.2 a second needed
  for 100,000 documents a day.
- _When would you move to a broker?_ At much higher job rates, when several services need to
  consume the same events, or when sub-second latency matters. Then I'd keep an outbox in
  PostgreSQL and relay it to the broker, so the transactional guarantee stays.
- _Why not pg-boss?_ A credible choice. Building it directly kept the lease, fencing and error
  classification visible and tested, in about the same amount of code as configuring a library
  ([ADR-008](../adr/008-retry-and-idempotency.md)).

## Why a separate worker?

**Say:** Isolation. OCR can use hundreds of megabytes and a full core for minutes; in the API
process it would slow every request and could take the API down with it. A separate process also
scales independently (more workers for a backlog, without more API instances), and a worker crash
loses at most one job, which the lease returns to the queue. The worker shuts down gracefully: on
SIGTERM it stops polling and finishes the job in progress.

**Evidence:** `apps/api/src/worker.ts`, `worker/polling-loop.ts`, `worker/worker.service.ts`.

**Follow-ups:**

- _But the demo runs it in the API process?_ Yes, because the free host has no background workers.
  Measured on that host's limits, a 20 MP photo peaked at 336 MB of 512 MB with the API running, so
  it fits. It's a deployment choice, not an architecture change.

## Why an AI provider abstraction?

**Say:** Development has to be free and offline, so locally it's Ollama with a small model; the
hosted demo can't run a model on 512 MB, so it's Cloudflare Workers AI. The extraction logic
depends on one interface, `AiProvider.generate`, and `AI_PROVIDER` picks the implementation. That
also puts the provider-specific details in one place: structured-output parameters, error codes
mapped to common kinds (timeout, rate limited, unavailable, invalid output), and `Retry-After`.
Swapping providers is a config change, and adding one is one class.

**Evidence:** [ADR-006](../adr/006-ai-provider-abstraction.md), `apps/api/src/ai/`.

**Follow-ups:**

- _Why not LangChain or a vendor SDK?_ Each provider is one HTTP call. A library would add surface
  for two `fetch` calls and hide the error handling I wanted to control.
- _Do providers retry?_ No. Retries belong to the job runner, so they show up in the job history and
  don't stack with another retry layer.
- _Which is better?_ The demo model (Llama 3.3 70B) is much stronger than the local 3B model.
  Measured locally on synthetic one-page documents, the 3B model got every field of an invoice and
  a scanned purchase order right but missed a contract's title, at about 30–60 s each on CPU
  ([measurements](../processing/document-extraction.md#measured-on-the-local-model)).
