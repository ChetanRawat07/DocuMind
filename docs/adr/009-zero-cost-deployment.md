# ADR-009: Zero-cost deployment architecture

- **Status:** Accepted (pipeline details in [ADR-021](021-deployment-pipeline.md))
- **Date:** 2026-10-26

## Context

The project must run at ₹0/$0 within provider free tiers. The plan targets Cloudflare Pages
(frontend), Render (backend), Supabase (PostgreSQL), Cloudflare R2 (storage) and Cloudflare
Workers AI.

Render's free tier covers web services but **not background workers**. Render staff confirm this
in its community forum, and its compute-plan docs list the free instance (512 MB RAM, 0.1 CPU) for
web services only. Free web services also spin down after a period of inactivity. These facts were
checked on 2026-10-26 and re-checked on 2026-11-04: Render's free page still lists no background
workers, cron jobs or disks, and pre-deploy commands are for paid services only. Its free page no
longer states the instance size, so 512 MB and 0.1 CPU are the last published figures.

## Decision

- Keep the target providers from the plan.
- Do not deploy a separate worker service. In the demo deployment, the worker runs inside the API's
  web service process, enabled by configuration (wired up in Phase 9/16). Locally, and in any future
  paid deployment, it runs as its own process (`node dist/worker.js`).
- Do not add infrastructure that has no free option.

## Alternatives

- **Paid Render background worker.** Violates the zero-cost constraint.
- **Another host with free background workers.** Not adopted in Phase 16: the in-process worker
  stays within the free instance's memory (measured in
  [deployment](../operations/deployment.md#measured-on-the-free-instances-limits)), so moving hosts
  would add a provider without fixing the CPU limit.

## Trade-offs

- An in-process worker shares 512 MB RAM and 0.1 CPU with the API, so OCR will be slow and must be
  memory-conscious.
- When the free service spins down, queued jobs wait until the next request wakes it. Jobs are
  durable in PostgreSQL (ADR-005), so they are delayed, not lost.

## Consequences

- The worker lifecycle must support graceful shutdown, since platform restarts send SIGTERM.
  Phase 0 implements this for the poll loop.
- The free-tier limits are documented in [deployment](../operations/deployment.md#free-tier-limits).
