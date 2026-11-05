# Scalability questions

[Back to interview preparation](README.md) · Full detail:
[performance review](../operations/performance-review.md)

The answers rest on measurements: a database with 1 million documents, 2,000 users and 3.4 million
audit entries, the real API under load, and OCR under the free host's CPU and memory limits.

## How would you process 100× more documents?

**Say:** From the demo's 100 a day to 10,000, the steps are, in order:

1. **Pay for AI throughput first.** The free allocation is about 27 documents a day.
2. **Move the worker out of the API process** and run 2–4 workers on 1–2 GB instances. 10,000
   documents a day is about 14 CPU-hours of OCR, roughly 0.6 cores on average and 2–3 at peaks. The
   queue needs no change.
3. **Run 2–4 jobs per worker process,** since a worker mostly waits for the AI, keeping OCR to one
   at a time for memory.
4. **A paid database plan:** about 30 GB a year with the page text, and a retention policy for
   text and audit entries.
5. **A shared store for rate limits** once there's more than one API instance.

At another 10× (100,000 a day, about 1.2 documents a second): 20–40 autoscaled workers, a lease
heartbeat, monthly partitions for the append-only tables, and native OCR or a managed service.

**Evidence:** [scaling path](../operations/performance-review.md#scaling-path).

## What becomes the first bottleneck?

**Say:** In the free demo, the AI allocation, then storage, because files never expire. With paid
AI, OCR CPU: about 5 CPU-seconds per document on a full core, and 2 minutes on the free host's
0.1 CPU. Not the database and not the queue. Every hot query is bounded to one user and indexed:
the document list stays at 4–5 ms with a million documents. The queue claimed 1,625 jobs a second,
over a thousand times what 100,000 documents a day needs.

**Follow-ups:**

- _What did you actually fix?_ The Processing page scanned every job of every user (534 ms for the
  largest account); an owner column on jobs made it 31 ms. A 20 MP photo needed over 500 MB for
  OCR; downscaling to the PDF render size cut 246 MB. JIT compilation cost more than it saved on
  these queries, so it's off for the app's role.
- _What's still slow?_ Analytics over 90 days for a single account with 100,000 documents: 2.4 s.
  Fine at realistic sizes; daily rollups would fix it.

## How would workers scale?

**Say:** Horizontally, without coordination: more processes against the same database.
`FOR UPDATE SKIP LOCKED` gives each job to one worker, and fencing by attempt number makes a lost
claim harmless. Autoscale on queue depth and the oldest queued job's age, which the processing
summary already reports. The limits are the database's connections (each worker has a pool) and
AI throughput. See [distributed systems](distributed-systems.md#how-does-the-system-scale-workers).

## How would PostgreSQL scale?

**Say:** In order of effort:

1. **Keep queries bounded and indexed per user,** as now, and measure with the real plans. That's
   what kept everything flat at a million documents.
2. **A bigger primary and a pooler** for connections.
3. **Partition the append-only tables** (`audit_logs`, `document_text_pages`) by month, so retention
   drops a partition instead of running a large `DELETE`.
4. **Read replicas** for analytics and the audit log if reporting grows.
5. **Shard by user** as the last step. Every user-facing query already filters by `user_id`, so the
   data model allows it.

**Follow-ups:**

- _Does the queue move out of PostgreSQL?_ Not at these rates. A broker pays off at much higher job
  rates, or when many services consume the same events; then an outbox keeps the transactional
  enqueue.
- _Migrations on big tables?_ The Phase 15 migration took 37 s on a million rows and hit the 30 s
  statement timeout. At that size: add the column, backfill in batches, then add constraints with
  `NOT VALID` and validate them separately.

## Where would caching help?

**Say:** Less than people expect, and I'd be careful about adding it. Document reads are per user,
indexed and cheap (4–5 ms), and they change as processing runs, so a cache would mostly add
staleness and invalidation bugs. The places it helps:

- **Already cached:** Supabase's public signing keys (JWKS), so token verification needs no network
  call; and the web app's built assets, which have content-hashed names and a one-year immutable
  cache header.
- **Next:** analytics, the heaviest query. Daily rollups per user, computed once per day, instead
  of a cache in front of the query.
- **Not worth it:** a cache for API responses. They're private, and every response is
  `Cache-Control: no-store` on purpose.
