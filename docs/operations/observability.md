# Observability

How to tell what DocuMind is doing and why something failed: structured logs, correlation ids,
the audit log, job timings and health checks. The decisions behind them are in
[ADR-019](../adr/019-observability-without-external-services.md).

## Following one request

Every API request gets a fresh id. It travels with the work the request causes:

```text
POST /documents (upload)          X-Request-Id: 7d5e1f0a-…    ← response header
  ├─ API log lines                 "requestId": "7d5e1f0a-…"
  ├─ audit entry document.uploaded request_id = 7d5e1f0a-…
  └─ processing job                request_id = 7d5e1f0a-…
        └─ worker run of the job   "requestId": "7d5e1f0a-…", "jobId": "…"
              ├─ AI call log lines (prompt, model, latency, tokens)
              ├─ audit entries      document.text_extracted, fields_extracted, approved, …
              └─ completion log     "Job … succeeded; needs review"
```

- **Generated, never accepted.** The API ignores an incoming `X-Request-Id`, so a client cannot
  choose or reuse ids.
- **Where you see it:**
  - The `X-Request-Id` header of every response.
  - `error.requestId` in error bodies. The web app shows it as a "Reference" on failed loads.
  - The Processing and Audit Logs screens.
- **How it propagates:** an `AsyncLocalStorage` context (`src/common/correlation/correlation.ts`)
  set by the first middleware (`src/http/request-correlation.ts`). The worker sets the same
  context from the job row before running it.
- **System actions:** a job's audit entries carry the id of the request that queued it. A lease
  expiry handled by another worker takes the id from the job row too.

To trace a user's report, search the logs for the reference they quote:

```sh
grep '7d5e1f0a-' api.log worker.log            # every line of the request and its job
```

```sql
SELECT occurred_at, action, metadata FROM audit_logs WHERE request_id = '7d5e1f0a-…';
SELECT * FROM processing_jobs WHERE request_id = '7d5e1f0a-…';
```

## Structured logs

`LOG_FORMAT=json` (the default) writes one JSON object per line. `pretty` is for local work.

```json
{
  "level": "log",
  "pid": 41,
  "timestamp": 1793710800000,
  "message": "AI call",
  "context": "AI",
  "requestId": "7d5e1f0a-…",
  "jobId": "9c1e…",
  "prompt": "document.extract.invoice@1",
  "provider": "ollama",
  "model": "qwen2.5:3b",
  "durationMs": 48211,
  "inputTokens": 2105,
  "outputTokens": 312
}
```

- **Fields are top-level keys.** Pass them after the message:
  `logger.log('Job succeeded', { attempt })`. The request and job ids are added to every line
  automatically; explicit fields win.
- **Redaction:** keys such as `password`, `token`, `authorization`, `apiKey` and `secret` are
  masked in logged objects at any depth. This is a safety net: code must not log them at all.
- **Never logged:**
  - Document text, field values or quotes.
  - Prompts and model answers.
  - Filenames and query strings (searches can contain names).
  - Tokens and secrets.

### Events

| Message                      | Process | Fields                                                          |
| ---------------------------- | ------- | --------------------------------------------------------------- |
| `Request handled`            | API     | `method`, `path` (no query), `status`, `durationMs`, `userId`   |
| `Job … started`              | worker  | `documentId`, `attempt`                                         |
| `Text extracted`             | worker  | `durationMs`, `pageCount`, `ocrPageCount`                       |
| `AI call` / `AI call failed` | worker  | `prompt`, `provider`, `model`, `durationMs`, tokens/`errorKind` |
| `Document analyzed`          | worker  | `durationMs`, `outcome`, `documentType`, `overallConfidence`    |
| `Job … succeeded; …`         | worker  | `attempt`, `documentStatus`                                     |
| `Job … failed …`             | worker  | `errorCode`, `attempt`, `retryAt`                               |
| `Job …: lease expired …`     | worker  | `jobId`, `attempt`, `errorCode`                                 |

- Health probes are logged at `debug`, everything else at `log`.
- An abandoned request is logged with `aborted: true`.
- Unexpected errors (5xx, `internal_error` jobs) are logged at `error` with their stack.

## Error tracking

There is no external error service. Errors are tracked in the logs:

- **5xx responses:** the API logs the error and stack. The client gets a generic message and the
  request id.
- **Failed jobs:** the error code is on the job (`last_error_code`), counted by code on the
  Processing screen, and written to an audit entry when the job is dead-lettered.
- **Alerting** is left to the log platform: for example, on `"level":"error"` lines or a rising
  failed-job count.

## Metrics: the Processing screen

`GET /processing/summary` and `GET /processing/jobs` compute everything from `processing_jobs`.
There is no metrics endpoint to scrape.

| Number                | Source                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Queued, running       | Jobs in that status now                                                                                                         |
| Completed, failed     | Jobs finished in the last 7 days                                                                                                |
| Processing time       | Average and 95th percentile of `finished_at − started_at`, succeeded jobs (first start to finish, retries and backoff included) |
| Text extraction (OCR) | `text_extraction_ms`: the step's time in the attempt that last ran it                                                           |
| AI                    | `ai_ms`: both AI calls, including failed ones (a timeout shows as a slow call)                                                  |
| Why jobs failed       | Failed jobs in the window, grouped by `last_error_code`                                                                         |

- **Owner-scoped:** everything covers only the signed-in user's documents. There is no
  cross-user operator view; an operator uses SQL (below).
- **Fenced writes:** durations are recorded like `stage`, so a worker that lost its job cannot
  overwrite them.

```sql
-- Across all users: the queue now, and the last day's failures by code
SELECT status, count(*) FROM processing_jobs GROUP BY status;
SELECT last_error_code, count(*) FROM processing_jobs
WHERE status = 'failed' AND finished_at > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC;
-- Step latency over the last day
SELECT avg(text_extraction_ms), avg(ai_ms),
       percentile_cont(0.95) WITHIN GROUP (ORDER BY ai_ms)
FROM processing_jobs WHERE finished_at > now() - interval '1 day';
```

## Audit log

Written by every security-relevant or user-visible action. The full list of actions is in
[schema.md](../database/schema.md#audit_logs).

- **`GET /audit-logs`:** the user's own actions plus the system's actions on documents they still
  own, newest first. Paged by id (`?cursor=`).
- **`GET /documents/:id/activity`:** one document's 50 most recent entries. The document page
  shows them as a timeline.
- **Never shown:** another user's entries.
- **Deleted documents:** the user's own entries about a deleted document remain; the system's
  entries about it are no longer listed.

## Health

| Endpoint                   | Checks                     | Use                                           |
| -------------------------- | -------------------------- | --------------------------------------------- |
| `GET /api/v1/health`       | Nothing (process is up)    | Liveness: restart when it fails               |
| `GET /api/v1/health/ready` | `SELECT 1` on the database | Readiness: stop routing traffic when it fails |

- **The worker has no HTTP port.** It exits when it cannot start, and the platform restarts it.
- **A worker that is alive but stuck** shows up as jobs whose lease expired: another worker
  releases them, and the "lease expired" log line and the `lease_expired` failure code record it.

## Known limitations

- **No cross-user operational view** in the UI; operators use SQL and the logs.
- **No alerting:** it depends on the hosting platform's log tooling.
- **Request ids stop at the API.** The web app does not send its own trace id, and the AI
  provider's own request ids are not logged.
- **Processing time includes backoff:** it runs from first start to finish. Per-attempt time is
  only in the logs.
- **Timings come from the last attempt that ran each step**, not a history per attempt.
- **The job list shows the 50 most recent jobs**, without paging.
- **Summary queries scan the user's jobs.** That is fine at demo volume; Phase 15 should review it.
