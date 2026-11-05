# Distributed systems questions

[Back to interview preparation](README.md) · Full detail: [job queue](../processing/job-queue.md),
[ADR-008](../adr/008-retry-and-idempotency.md)

Delivery is **at least once**: a job can run more than once, so every step is safe to repeat.
That is the frame for all of these answers.

## What happens when a worker crashes?

**Say:** The job stays `running`, but its claim has a lease: `lease_expires_at`, set at claim time to
twice the AI timeout plus five minutes, which is 15 minutes by default. Every poll from any worker
first releases expired leases: the job goes back to `queued` with `lease_expired` as its error, or
to `failed` if it has used its three attempts. Another worker then claims it and runs it again.
Text already extracted is reused, and if the crash came after the extraction was stored, the
unique constraint on `job_id` returns the stored row instead of a duplicate.

The subtle case is a worker that isn't dead, only paused (a long GC pause or a frozen VM), and
wakes up after its job was handed to someone else. Every write it makes is fenced with
`status = 'running' AND attempts = <the attempt it claimed>`. The new claim incremented
`attempts`, so the stale worker's writes match no row and change nothing. It logs `claim lost`
and moves on.

**Evidence:** [claiming and fencing](../processing/job-queue.md#claiming-and-fencing); the test
"refuses every write from a worker whose claim was taken over" in
`apps/api/src/jobs/processing-jobs.repository.integration.spec.ts`.

**Follow-ups:**

- _Why no heartbeat?_ Simpler, with no background timer that can itself fail. The cost is that
  crash recovery takes up to 15 minutes, and a job must finish within its lease. With many workers
  on slow CPUs, a large scan could outlast it and be repeated; that's when I'd add a heartbeat.
- _What about the external side effects of a repeated job?_ The only one is the AI call: a repeat
  costs time and AI quota, but stores nothing twice.
- _And graceful shutdown?_ SIGTERM stops polling and lets the current job finish before the
  database pool closes. If the platform kills the process first, the lease covers it.

## What happens when messages are duplicated?

**Say:** There's no message to duplicate: a job is a row, and claiming it is one atomic `UPDATE`
on a row locked with `FOR UPDATE SKIP LOCKED`. Two workers can't claim the same job, because the
second skips the locked row. Duplicate _requests_ are possible: a user double-clicks reprocess, a
client retries, the upload races a reprocess. Those all hit the partial unique index that allows
one active job per document, so they return the existing job.

**Follow-ups:**

- _And if you moved to a broker with at-least-once delivery?_ The consumer would need the same
  idempotency: the job id becomes the deduplication key, and the fenced writes and
  `UNIQUE (job_id)` on the result stay exactly as they are.

## How are retries handled?

**Say:** Every failure is classified as retryable or permanent. A corrupt or encrypted PDF, a file
over the page limit, or an unsupported document type won't get better, so it fails at once. A
timeout, rate limit, provider outage, invalid model output, OCR engine error or unknown error is
retried. Retries back off exponentially: about 30 s, then 1 min, then 2 min, capped at 15 min,
and half of each delay is random jitter, so jobs that failed together during an outage don't all
retry at the same moment. A provider's `Retry-After` is the minimum. After three attempts the job
is `failed`, the dead letter, with its error code kept, and the user can requeue it from the
document page.

**Evidence:** [failure classification](../processing/job-queue.md#failure-classification),
`apps/api/src/worker/job-failure.ts`.

**Follow-ups:**

- _Why "equal jitter" and not full jitter?_ Half fixed, half random guarantees a minimum spacing
  between attempts while still spreading them out.
- _Why do providers never retry internally?_ Two retry layers multiply (three times three is nine
  calls), and retries inside a provider are invisible in the job history.
- _What's retried that probably shouldn't be?_ `ai_invalid_output`: at temperature 0 a retry often
  returns the same answer. It's cheap to keep, and a provider can still vary.

## How does the system scale workers?

**Say:** Horizontally, with no coordination: start more worker processes against the same
database. `SKIP LOCKED` hands each job to exactly one of them, and fencing makes a lost claim
harmless, so there's no leader election, no partitioning and no worker registry. Measured: 218 jobs
a second with one worker, 658 with four, 1,625 with sixteen. 100,000 documents a day needs about
1.2. So the queue isn't the limit; OCR CPU, AI throughput and database connections are.

**Evidence:** [performance review, queue](../operations/performance-review.md#queue).

**Follow-ups:**

- _How would you autoscale?_ On queue depth and the age of the oldest queued job. The processing
  summary already reports both (`queued`, `oldestQueuedAt`).
- _What about connections?_ Each worker has its own pool, so workers × pool size must stay under the
  database's connection limit, through a pooler at that point.
- _Why one job per worker process?_ Simplicity and bounded memory: one OCR job peaks near 300 MB.
  Since the worker mostly waits on the AI, a per-process concurrency of 2–4 jobs, with OCR limited
  to one at a time, is the next step.

## What happens if the AI is unavailable?

**Say:** Uploads keep working: the API never calls the AI. The worker extracts the text, then the AI
call fails as `ai_unavailable`, `ai_timeout` or `ai_rate_limited`, all retryable, so the job goes
back to the queue with backoff. Text extraction is skipped on the retry because the text is stored.
If the outage outlasts three attempts (a few minutes), the job is dead-lettered with that error
code, visible on the Processing page, and the user can reprocess it later. Nothing is lost, and a
wrong API key (`ai_authentication`) fails at once instead of retrying.

**Follow-ups:**

- _Would you add a fallback provider?_ It's easy behind the interface, but the two models give
  different results, so the extraction must record which one answered. It already does
  (`ai_provider`, `ai_model` on each extraction).
- _A circuit breaker?_ Worth adding at scale: after repeated `ai_unavailable` errors, stop claiming
  jobs for a while instead of spending three attempts per job during an outage.
- _What if the AI succeeds but the database write fails?_ Nothing is stored: the extraction, the job
  completion and the document status commit together. The job retries as `internal_error` and calls
  the AI again.
