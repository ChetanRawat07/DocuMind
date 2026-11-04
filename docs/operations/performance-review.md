# Performance and scalability review (Phase 15)

What DocuMind costs per request and per document, measured rather than estimated, where it
breaks first as volume grows, and what to change at each step. Nothing here adds infrastructure:
the system was measured as it is, three problems were fixed, and the rest is a plan.

## Method

- **Data volume.** A separate database, `documind_perf`, was migrated and filled with synthetic
  rows:
  - 2,000 users and 1,000,000 documents over 100 days, with the jobs, extractions, reviews, page
    text and 3.4 million audit entries they would have.
  - Users are skewed: the median user has 320 documents and the busiest ordinary user 20,000.
    One account has 100,000 documents, as an upper bound; the processing quota (50 a day) caps a
    real user at about 18,000 a year.
  - The whole database is 4.2 GB, about 4.4 KB per document.
- **Queries.**
  - The compiled API ran against that database, with tokens signed locally as in the tests.
  - Each endpoint was timed 15 times per user tier.
  - Postgres's `auto_explain` logged the actual plan of every query over 20 ms. The plans, not
    guesses about the code, decided what to fix.
- **Pipeline.**
  - Text extraction and OCR were timed on generated documents, each case in a fresh process, on a
    full core and under a 10% CPU quota (`systemd-run -p CPUQuota=10%`).
  - The quota stands in for the free host's 0.1 CPU.
- **Queue.** Workers claimed and finished the 2,000-job backlog with no processing in between.
- **Code review.** An independent agent read the data-access code for N+1 and unbounded queries.
  Its findings were treated as hypotheses and confirmed or rejected by the measurements above.

A first run made the audit log look slow (2.8 s). The cause was the seed, not the code: audit ids
did not follow time, as they do in production. After renumbering them in time order the query took
6 ms. The results below are from the corrected data.

Machine: 12 cores, PostgreSQL 17 in Docker with 128 MB shared buffers (similar to the smallest
Supabase instance).

## Results

### API latency (p50, ms)

| Endpoint                          | Median user | Top user (20k docs) | 100k-doc account |
| --------------------------------- | ----------: | ------------------: | ---------------: |
| `GET /documents` (any page)       |           4 |                   4 |                5 |
| Document detail, jobs, extraction |         3–5 |                 3–4 |              4–6 |
| `GET /audit-logs`                 |           9 |                   6 |                6 |
| `GET /processing/summary`, before |           9 |                 220 |              534 |
| `GET /processing/summary`, after  |           6 |                  12 |               31 |
| `GET /processing/jobs`, before    |           7 |                 125 |              153 |
| `GET /processing/jobs`, after     |           5 |                   6 |                5 |
| Filename search (`q=`)            |           3 |                  22 |               85 |
| Sort by name                      |           4 |                  20 |               41 |
| `GET /analytics?days=90`, after   |          18 |                 634 |            2,443 |

Throughput of one API process on a full core, mixed list and analytics requests from 200 users:

| Concurrency | Requests/s | p50 (ms) | p95 (ms) |
| ----------: | ---------: | -------: | -------: |
|           1 |         92 |        4 |       29 |
|          10 |        399 |       11 |       58 |
|          50 |        457 |       98 |      159 |

Under a 10% CPU quota the same process serves 7–10 requests a second, with a p95 of 0.4–2 s.

### Document pipeline

| Case                           | Full core | 10% CPU | Peak memory, above a 135 MB baseline |
| ------------------------------ | --------: | ------: | -----------------------------------: |
| 10-page typed PDF (text layer) |    0.17 s |       — |                               +10 MB |
| 1 scanned page (engine start)  |     3.6 s |    86 s |                              +190 MB |
| 5 scanned pages                |      15 s |   340 s |                              +254 MB |
| 20 scanned pages (10 MB file)  |      59 s |       — |                              +269 MB |
| 20 MP photo, before            |     5.6 s |       — |                              +524 MB |
| 20 MP photo, after             |     3.0 s |       — |                              +278 MB |

- OCR costs about 3 s per dense page on a full core; starting the engine adds about 0.6 s. The
  text-extraction doc's 1.2 s per page was measured on sparser pages.
- A 10% quota made OCR 24 times slower, not 10. The quota throttles in bursts.
- The idle API and worker processes take about 200 MB each.

### Queue

Claim, set stage and finish, with no work in between, on a table of 1 million jobs:

| Workers | Jobs/s |
| ------: | -----: |
|       1 |    218 |
|       4 |    658 |
|      16 |  1,625 |

At 100,000 documents a day the queue needs 1.2 jobs a second. Its overhead is more than 1,000
times below that.

## Findings

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                              | Resolution                                                                                                                                                                                                                 |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | HIGH     | The Processing summary and job list scanned the **whole** `processing_jobs` table for every user: jobs had no owner column, so the plan hashed every job against the user's documents. Cost grew with all users' traffic: 220–534 ms at 1 million jobs, and about 36 million rows a year at 100,000 documents a day. | Fixed: `processing_jobs.user_id`, held equal to the document's owner by a composite foreign key, with indexes for the list order and the summary window (ADR-020). Now 5–31 ms, and bounded by the user's own recent jobs. |
| 2   | HIGH     | OCR of a large photo needed over 500 MB on top of the process. The free instance runs the API and worker together in 512 MB, so one 20 MP photo would crash it, and the job's retries would crash it again.                                                                                                          | Fixed: images over A4 at 200 DPI (3.9 MP), the resolution PDF pages already use, are downscaled before OCR. The peak fell by 246 MB, and the upload limit stays at 25 MP.                                                  |
| 3   | MEDIUM   | JIT compilation took 15% of slow-query time: 252 ms of one 1.2 s analytics query. It triggers on cost estimates, so it hit the largest accounts hardest. Upstream PostgreSQL has since made it off by default.                                                                                                       | Fixed: `ALTER ROLE CURRENT_USER SET jit = off` in a migration. A role setting, because Supabase's transaction-mode pooler does not keep session settings (ADR-020).                                                        |
| 4   | LOW      | Deleting a user checked `extraction_reviews.decided_by` with a full scan of every review: 32 ms at 340,000 reviews, about 1 s at 10 million, while the user row is locked.                                                                                                                                           | Fixed: a partial index on `decided_by`.                                                                                                                                                                                    |
| 5   | LOW      | Analytics reads every document the user processed in the window. That is bounded by the quota (at most 4,500 in 90 days, an estimated 150 ms), and it does not grow with other users' traffic. The 100,000-document account takes 2.4 s.                                                                             | Accepted. If accounts outgrow the quota (organizations), keep daily per-user rollups.                                                                                                                                      |
| 6   | LOW      | Filename search (`ILIKE '%x%'`) and name sorts read every document the user owns: 22 ms at 20,000, 85 ms at 100,000. They grow with one user's history, not with total traffic.                                                                                                                                      | Accepted. A `pg_trgm` GIN index would serve search once accounts are that large; it costs a write per upload until then.                                                                                                   |
| 7   | LOW      | A worker retrying a job loads the page text twice: once to see whether text exists, once to analyze it. On a first attempt the check finds nothing and returns at once.                                                                                                                                              | Accepted: a few MB of reads against seconds of OCR and AI.                                                                                                                                                                 |
| 8   | LOW      | `/audit-logs` merges the user's own entries with system entries about their documents. For a large account that has been quiet for months, the second half reads every system entry of every document it owns.                                                                                                       | Accepted: 4 ms for a dormant median user. At organization scale, store the owner on system entries as finding 1 did for jobs.                                                                                              |
| 9   | INFO     | Adding `user_id` to 1 million jobs took 37 s under an `ACCESS EXCLUSIVE` lock, and the default 30 s statement timeout stopped it. The migration rolled back cleanly.                                                                                                                                                 | Fine for the demo's data. At scale, add the column, backfill in batches, then add the constraint `NOT VALID` and validate it.                                                                                              |

**Already sound**, measured under the same load:

- Keyset pagination: 4–5 ms on any page, even for the 100,000-document account.
- The claim and lease queries use partial indexes and `SKIP LOCKED`.
- The quota count: 0.1 ms (Phase 13).
- Every list is capped at 100 rows; downloads stream; the web app does not poll.
- No OCR or AI work runs inside a transaction.

## Capacity: what runs out first

The cost per document comes from the measurements above. It assumes 2 pages a document on
average, 40% of them scanned, and the OCR visibility check on auto-approvable text-layer
documents.

- About **5 CPU-seconds** of OCR per document on a full core, and about **2 minutes** on the free
  instance.
- **2 AI calls.** Their latency was not measured here; Workers AI is a cloud call.
- About **4–8 KB** of database rows and **0.3–1 MB** of stored file.

Free-tier limits change. They were rechecked in Phase 16 ([deployment](deployment.md#free-tier-limits)).

| Limit                                     | Free allowance                | Documents it supports                                   |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------- |
| Workers AI (`docs/ai/ai-providers.md`)    | 10,000 Neurons/day, ~55 calls | **~27 a day**                                           |
| Render CPU (0.1 CPU, shared with the API) | 86,400 × 0.1 CPU-seconds/day  | ~600 a day of continuous OCR; minutes of delay per scan |
| Render memory                             | 512 MB                        | One job at a time (finding 2)                           |
| Cloudflare R2 storage                     | 10 GB-month                   | ~10,000–33,000 files kept                               |
| Supabase database                         | 500 MB                        | ~60,000–110,000 documents kept                          |

At **100 documents a day** the demo hits the AI allocation first, then R2 storage after roughly
3–11 months, because nothing expires (ADR-010). CPU and the database are not the limit.

## Scaling path

### 100 documents a day: the demo

- **Deployment:** one Render free instance running the API and the worker, Supabase free, R2 free.
- **Needed:** an AI budget beyond about 27 documents a day: a paid Workers AI plan, a smaller
  model, or a cap on documents a day.
- **Expect:** minutes of processing per scanned page, and a cold start after the free instance
  spins down. Jobs wait in PostgreSQL meanwhile; they are delayed, not lost (ADR-009).

### 10,000 documents a day

About 0.12 documents a second on average, with peaks of perhaps 1 a second. About 20,000 AI calls
and 14 CPU-hours of OCR a day.

- **Separate the worker from the API.** Run 2–4 worker processes on 1–2 GB instances: OCR peaks
  near 300 MB per job, and 14 CPU-hours a day is about 0.6 cores on average and 2–3 at peaks.
  The queue needs no change: `SKIP LOCKED` already shares jobs safely.
- **Run several jobs per worker process.** A worker waits seconds for each AI call, so a small
  per-process concurrency (2–4 jobs) uses the core while it waits. Keep OCR at one or two at a
  time to bound memory.
- **The database:**
  - About 3.6 million documents and 20 million audit entries a year, roughly 30 GB with text.
    That needs a paid Supabase plan.
  - Queries stay as measured, because every hot query is bounded per user. Add an archive or
    retention policy for page text and audit entries.
  - Connections: API pool 10 plus 10 per worker, through the transaction pooler.
- **Storage:** 3–10 GB a day in R2, about $0.015 per GB-month. A retention period becomes a
  product decision.
- **Rate limits:** move the per-process counters (Phase 13) to a shared store once the API has
  more than one instance.

### 100,000 documents a day

About 1.2 documents a second on average and around 5 at peaks. About 200,000 AI calls and 140
CPU-hours of OCR a day.

- **Workers:**
  - 20–40 worker processes, autoscaled on queue depth and the oldest queued job's age; the
    Processing summary already reports both.
  - Add a lease heartbeat. On slow CPUs a large scan can outlast the 15-minute lease, and with
    many workers another worker would take it over and repeat it (ADR-008 chose no heartbeat;
    the demo's single worker cannot be taken over).
- **PostgreSQL:**
  - A larger primary. Partition `audit_logs` and `document_text_pages` by month, so old data is
    dropped by partition instead of by `DELETE`.
  - Read replicas for analytics and the audit log, if those reads grow.
  - The queue stays in PostgreSQL: 1.2 jobs a second is far below the 1,600 a second measured.
    A dedicated broker only pays off at much higher rates, or with many consumers of the same
    events.
- **OCR:** OCR becomes the main cost. Options:
  - A native Tesseract instead of WebAssembly, or a managed OCR service. ADR-007 rejected those
    for cost and privacy; revisit with a budget.
  - Skip OCR on pages with a good text layer, as now, and keep the visibility check to its 3 pages.
- **AI:** a provider contract with throughput guarantees, and batching or a smaller model for
  classification.
- **Caching:** little to gain. Document reads are per user and cheap. The candidates are analytics
  (daily rollups) and the JWKS keys, which are already cached.

## Interview notes

- **What becomes the first bottleneck at 100× traffic?** In the demo, the AI allocation and the
  CPU. At 10,000 a day, OCR CPU and storage. Not the database, and not the queue.
- **How do workers scale?** Horizontally: `FOR UPDATE SKIP LOCKED` gives each job to one worker
  without coordination, and fencing by attempt number makes a lost claim harmless. Measured: 16
  workers, 1,625 claims a second.
- **How does PostgreSQL scale?** Keep every hot query bounded per user and indexed, as measured
  above. Then partition the append-only tables by time, add read replicas for reporting, and use a
  bigger primary. Sharding by user is the last step, and the user-scoped queries already allow it.
- **Why denormalize the owner onto jobs?** Without it, "my jobs" means joining through documents,
  and the planner hashed every job in the table. The composite foreign key makes the copy
  impossible to get wrong.
