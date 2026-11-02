# Job queue and worker

Processing runs in the worker process, never in an HTTP request (ADR-004). Jobs are rows in
`processing_jobs`, and PostgreSQL is the queue (ADR-005). The retry and idempotency rules are
recorded in [ADR-008](../adr/008-retry-and-idempotency.md).

Code:

- `src/jobs/processing-jobs.repository.ts`: enqueue, claim, fenced finish, lease release.
- `src/worker/document-processor.ts`: the pipeline for one job.
- `src/worker/job-failure.ts`: failure classification and backoff.
- `src/worker/worker.service.ts`: the poll loop.

## Lifecycle

```text
upload ──(one transaction)──> document queued + job queued
                                       │
             worker claims (SKIP LOCKED, attempts + 1, lease)
                                       ▼
                          document processing, job running
               text_extraction stage ──> ai_extraction stage
                                       │
      ┌─────────────────┬──────────────┴───────────┬─────────────────────┐
  extracted       retryable error,          permanent error,         lease expired
      │           attempts left             or none left             (worker crashed)
      ▼                 ▼                          ▼                       ▼
 job succeeded    job queued again           job failed              requeued, or failed
 document         (backoff),                 (dead letter),          when no attempts left
 needs_review     document queued            document failed
```

| Job status  | Meaning                                                    | Document status          |
| ----------- | ---------------------------------------------------------- | ------------------------ |
| `queued`    | Waiting; `available_at` is when it may run (retry backoff) | `queued`                 |
| `running`   | Claimed by `locked_by` until `lease_expires_at`            | `processing`             |
| `succeeded` | Extraction stored                                          | `needs_review`           |
| `failed`    | Dead letter: no further attempts                           | `failed` (retry via API) |

Every extraction goes to `needs_review`; Phase 10 decides which may complete without review.

## Claiming and fencing

```sql
UPDATE processing_jobs
SET status = 'running', attempts = attempts + 1, locked_by = $worker,
    locked_at = now(), lease_expires_at = now() + $lease, started_at = coalesce(started_at, now())
WHERE id = (SELECT id FROM processing_jobs
            WHERE status = 'queued' AND available_at <= now()
            ORDER BY available_at LIMIT 1
            FOR UPDATE SKIP LOCKED)
RETURNING *;
```

- `SKIP LOCKED` lets concurrent workers pass over a row another worker is claiming, so each job goes
  to exactly one worker and nobody waits. The partial index `processing_jobs_claimable_idx` serves
  the subquery.
- The lease is `2 × AI_TIMEOUT_MS + 5 min`, longer than the slowest possible run.
- Every later write is fenced with `status = 'running' AND attempts = <claimed attempt>`. Each claim
  increments `attempts`, so a worker whose job was taken over matches nothing and its writes are
  dropped. The worker logs `claim lost`.

## Failure classification

| Code                                                                    | Source             | Retried |
| ----------------------------------------------------------------------- | ------------------ | ------- |
| `ocr_failed`                                                            | OCR engine         | Yes     |
| `unreadable_pdf`, `encrypted_pdf`, `too_many_pages`, `unreadable_image` | The file itself    | No      |
| `image_too_large`, `unsupported_type`, `page_text_too_long`             | The file itself    | No      |
| `no_text`                                                               | Nothing to analyze | No      |
| `ai_timeout`, `ai_rate_limited`, `ai_unavailable`, `ai_invalid_output`  | AI provider        | Yes     |
| `ai_authentication`, `ai_invalid_request`                               | AI provider        | No      |
| `unsupported_document_type`                                             | Classifier         | No      |
| `file_missing`                                                          | Storage            | No      |
| `lease_expired`                                                         | Worker crash/hang  | Yes     |
| `internal_error`                                                        | Anything else      | Yes     |

- Retries wait `30 s × 2^(attempt−1)`, capped at 15 min. Half of that is random jitter. A
  provider's `Retry-After` is the minimum wait.
- Jobs have three attempts (`max_attempts`).
- `last_error_message` holds the error class's own message, which describes the file or the
  service, never document content.
- For `internal_error` the stored message is fixed; the real error and stack go to the worker log.
- The API exposes the code only.

## API

| Method | Path                         | Result                                                                       |
| ------ | ---------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/api/v1/documents/:id/jobs` | The 20 most recent jobs, newest first: status, stage, attempts, `errorCode`… |
| POST   | `/api/v1/documents/:id/jobs` | 202 with a new queued job, for a `failed` or `uploaded` document             |

- **POST is idempotent.** For a document that is already queued or processing, it returns the
  active job.
- **POST returns 409** for documents in review or completed, so a retry cannot replace reviewed
  results.
- Both routes return 404 for another user's document.

## What if…

- **…the worker crashes mid-job?** The job stays `running` until its lease expires. The next poll
  of any worker requeues it (or fails it on the last attempt), and it runs again. Text already
  stored is reused.
- **…a message is duplicated?** There are no messages to duplicate: a job is a row, and claiming
  is an atomic update. Duplicate requests to queue a document hit the one-active-job index and
  return the existing job.
- **…the AI succeeds but the database write fails?** Nothing was stored: the extraction, the job
  completion and the document status commit together. The error is retried as `internal_error`,
  and the AI is called again.
- **…a job is stuck?** A hung worker stops finishing, so its lease expires and another worker takes
  over. If the hung worker wakes up, its writes are fenced out.
- **…the document is deleted while its job runs?** The job row is deleted with it (cascade). Text
  extraction returns null, or the fenced writes match nothing, and the worker moves on.
- **…how does it scale?** Run more worker processes: `SKIP LOCKED` spreads jobs between them with
  no coordination. The limits are database connections, AI throughput and OCR CPU. At very high job
  rates the polling queries would need `LISTEN/NOTIFY` or a dedicated broker (Phase 15).

## Operating it

- **Running it:** `npm run dev` runs the API and a worker. `npm run start:worker -w @documind/api`
  runs a built worker alone. Run it several times for more workers.
- **Shutdown:** SIGTERM lets the job in progress finish, which can take minutes. If the platform
  kills the process first, the lease covers it.
- **Inspecting the queue:**

  ```sql
  SELECT status, count(*) FROM processing_jobs GROUP BY status;
  SELECT id, document_id, attempts, last_error_code, finished_at
  FROM processing_jobs WHERE status = 'failed' ORDER BY finished_at DESC LIMIT 20;
  ```

- **Audit entries:**
  - `document.uploaded` now includes the `jobId`.
  - `document.processing_requested` is written for a user retry.
  - `document.processing_failed` (`jobId`, `errorCode`, `attempts`) is written when a job is dead
    lettered.
  - Success is recorded by `document.fields_extracted`.

## Known limitations

- **Slow crash recovery:** a crashed worker's job waits up to the lease, 15 minutes by default.
- **One job at a time:** each worker process handles a single job; there is no per-process
  concurrency setting.
- **Coarse stages:** stages are `text_extraction` and `ai_extraction` only. Classification and
  validation run inside the AI stage.
- **Polling:** latency up to `WORKER_POLL_INTERVAL_MS` after an empty poll.
- **No automatic UI updates:** the web app shows the document status but does not refresh it while
  processing runs.
- **Not yet wired up for the demo:** running the worker inside the API process on the free host is
  Phase 16.
