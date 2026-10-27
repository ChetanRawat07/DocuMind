# ADR-005: PostgreSQL-backed job queue (no RabbitMQ)

- **Status:** Accepted. Replaces the plan's original "ADR-005 RabbitMQ for Local Development".
- **Date:** 2026-10-26

## Context

ADR-004 requires a durable queue between the API and the worker. The plan originally proposed
RabbitMQ locally and a zero-cost alternative in production, and warns against deploying RabbitMQ
"merely for architectural appearance".

Two problems with RabbitMQ here:

1. **Zero cost.** A continuously hosted broker is not free (free hosted plans exist but add an
   external dependency with tight limits).
2. **Dual writes.** Creating a document row in PostgreSQL and publishing a message to a broker are
   two separate systems. If the commit succeeds and the publish fails (or the reverse), a document
   is never processed or a job references a row that does not exist. Fixing that requires an outbox
   table, which is itself a PostgreSQL queue.

Running RabbitMQ locally and something else in production would also mean the code path tested
locally is not the one that runs in production.

## Decision

Use PostgreSQL as the job queue in every environment. Jobs are rows in a jobs table (designed in
Phase 1, behavior built in Phase 9). Workers claim jobs with `SELECT … FOR UPDATE SKIP LOCKED`, so
several workers can poll concurrently without claiming the same job or blocking each other.

The job design must cover: a status state machine, attempt count and maximum attempts, `available_at`
for backoff scheduling, `locked_at`/lease expiry and lock owner for stale-job recovery after a worker
crash, last error details, a uniqueness constraint that prevents duplicate active jobs for the same
document, and transactional enqueueing together with the document insert.

## Alternatives

- **RabbitMQ locally, PostgreSQL in production.** Two implementations, dev/prod divergence and an
  outbox still required.
- **RabbitMQ everywhere on a free hosted plan.** One mechanism, but an external free-tier dependency,
  an extra hop for document metadata, and still an outbox.
- **Redis-based queue (for example BullMQ).** Another service to host; Redis persistence settings
  matter for durability; same dual-write problem.
- **A library such as pg-boss.** A credible option; deferred to Phase 9, where building the claim
  logic directly versus adopting a library will be decided with the actual schema in hand.

## Trade-offs

- Polling adds latency (up to `WORKER_POLL_INTERVAL_MS`) and steady background queries.
  `LISTEN/NOTIFY` can reduce latency later if needed.
- PostgreSQL is not a high-throughput broker. Throughput is bounded by database capacity, which is
  far beyond portfolio-scale needs; Phase 15 revisits this.
- Features such as routing, fan-out and consumer groups must be built if ever needed.

## Consequences

- Enqueueing a job is a row insert in the same transaction as the document insert, so there is no
  dual-write window.
- The job table doubles as the source of job status for the Processing UI and analytics.
- Local infrastructure is PostgreSQL only; there is no RabbitMQ service in `docker-compose.yml`.
