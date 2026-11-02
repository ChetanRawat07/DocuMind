# ADR-008: Retry and idempotency strategy

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The worker (ADR-004) takes jobs from the PostgreSQL queue (ADR-005) and runs slow, unreliable steps:
OCR, then two AI calls of up to `AI_TIMEOUT_MS` each. A worker can crash or be killed mid-job. A
request can be repeated. An AI call can succeed while the write that follows it fails. Whatever
happens, a document must not be processed into two results, and must not be left stuck.

Exactly-once delivery is not possible across a crash: a worker that dies after its work but before
recording it looks the same as one that died before starting. The design therefore aims for
at-least-once execution with effects that apply once.

## Decision

- **Build on the existing table, no library.** The Phase 1 `processing_jobs` table already has the
  status, attempt, lease and error columns, with CHECK constraints for each state. pg-boss would
  bring a second job schema to keep in step with it.
- **One active job per document.** The partial unique index from Phase 1 makes enqueueing
  idempotent. Upload creates the job in the document's transaction.
- **Claiming.** A worker claims the oldest due job with `UPDATE … WHERE id = (SELECT … FOR UPDATE
SKIP LOCKED LIMIT 1)`. The claim increments `attempts` and sets a lease.
- **Fixed lease, no heartbeat.** The lease is `2 × AI_TIMEOUT_MS + 5 min` (15 minutes with the
  defaults), longer than the slowest possible run. A job whose lease expired is requeued, or failed
  when no attempts remain. Every poll checks for expired leases before claiming.
- **Fencing.** The attempt number is the fencing token: every write after a claim requires
  `status = 'running' AND attempts = <claimed attempt>`. A worker that lost its job to a takeover
  changes nothing.
- **Atomic success.** Marking the job succeeded, saving the extraction and moving the document to
  `needs_review` happen in one transaction, and the fenced update runs first. The extraction is
  also unique per job.
- **Retries.** Every error is classified as retryable or permanent: each error class already
  knows, and unknown errors count as retryable. A retryable failure with attempts left returns the
  job to the queue after exponential backoff with equal jitter (about 30 s, 1 min, 2 min…, capped
  at 15 min), never sooner than a provider's `Retry-After`. Anything else fails the job.
- **Dead letter.** A failed job stays in the table with its error code, stage and attempts, and the
  document becomes `failed`. Users retry with `POST /documents/:id/jobs`, which creates a new job.
  This is allowed only from `failed` or `uploaded`, so it cannot overwrite a document in review.
- **Steps are safe to repeat.** Stored text is reused, since files never change, and the
  extraction is stored once per job. AI calls may repeat after a crash; stored results do not.

## Alternatives

- **Heartbeat with a short lease.** Faster recovery after a crash (about 2 minutes instead of 15),
  but it is a second mechanism. A job that hangs while its process stays alive would also keep its
  lease forever, unless a deadline is added as well.
- **pg-boss.** Mature retries, backoff and dead letters, but its own schema, which duplicates
  `processing_jobs` and the foreign keys that tie jobs to documents and extractions.
- **A separate dead-letter table.** It only moves rows. A `failed` status is already queryable,
  and the job history stays in one place.
- **Retrying the same job on user request.** That would reset attempts and blur the history. A
  new job keeps each run's record intact.

## Trade-offs

- After a crash, a job waits up to the lease (15 minutes by default) before it is retried.
- A crash between the AI calls and the final commit repeats the AI calls, at their cost in time
  and quota.
- A job that crashes its worker every time fails only after `max_attempts` leases, about 45
  minutes.
- Each worker process runs one job at a time. Throughput scales by adding processes.

## Consequences

- Answers to the "what if…" questions are in
  [docs/processing/job-queue.md](../processing/job-queue.md).
- Running the worker inside the API process on the free demo host (ADR-009) is wired up in Phase 16.
- Phase 10 decides which extractions may skip review. Until then every extraction goes to
  `needs_review`.
