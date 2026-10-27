# ADR-001: Modular monolith, one Nest app, two entrypoints

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

DocuMind needs an HTTP API and a background worker (OCR and AI extraction are too slow for a
request). Both need the same configuration, database access, repositories, domain services and
storage abstraction. The team is one developer, the operating budget is zero, and Render's free
tier offers web services but no background workers (see ADR-009).

The development plan sketches separate `backend/` and `worker/` packages.

## Decision

Build one NestJS application in `apps/api` with two process entrypoints:

- `src/main.ts` creates an HTTP application from `AppModule` (controllers, HTTP concerns).
- `src/worker.ts` creates a Nest application context (no HTTP server) from `WorkerModule`.

Both root modules import the same shared feature modules (config today; database, repositories,
storage and domain services in later phases). API-only concerns (controllers, CORS, security
headers, the HTTP exception filter) live under `src/http`, `src/health` and future controller
modules. Worker-only concerns live under `src/worker`.

Locally the two run as separate processes. On the zero-cost deployment the worker can run inside
the API process instead (wired up in Phase 9/16), because both are the same codebase.

## Alternatives

- **Separate `backend/` and `worker/` packages (the plan's sketch).** Shared code would need to move
  into extra packages or be duplicated, with no deployment benefit: the worker cannot be deployed
  separately for free anyway.
- **Microservices.** Independent deploys and scaling are not needed at portfolio scale and would add
  network failure modes, distributed tracing needs and hosting cost.
- **Single process only.** Simplest, but couples request latency and memory to OCR/AI work and makes
  it impossible to scale workers independently later.

## Trade-offs

- One dependency graph: the worker process loads packages it does not use (for example Express).
- Module boundaries are enforced by convention and review, not by package boundaries.

## Consequences

- The worker can be extracted into its own deployable later by giving `worker.ts` its own image;
  no code moves are required as long as feature modules stay free of HTTP concerns.
- Feature modules must not import HTTP-specific code, or the worker would inherit it.
