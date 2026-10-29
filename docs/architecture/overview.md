# Architecture overview

This document describes the architecture **as implemented** and marks planned parts explicitly.
Decisions and their reasoning live in [the ADRs](../adr/README.md).

## Current state: Phase 1 (database and data model)

Implemented: repository structure, the API process with liveness and readiness endpoints, the
worker process skeleton, shared contracts, configuration validation, the PostgreSQL schema with
migrations, generated row types, repositories for every table, a development seed, linting,
formatting, unit tests and database integration tests. Not yet implemented: authentication,
uploads, storage, OCR, AI, job processing, and the product UI.

The schema, its constraints and indexes are documented in [database/schema.md](../database/schema.md).

## Runtime view

```text
                 Browser
                    │
                    ▼
     ┌──────────────────────────────┐
     │ apps/web (React + Vite)      │   dev: Vite server proxies /api → API
     └──────────────┬───────────────┘   demo: Cloudflare Pages (Phase 16)
                    │ HTTPS /api/v1/*
                    ▼
     ┌──────────────────────────────┐        ┌──────────────────────────────┐
     │ API process  (main.ts)       │        │ Worker process (worker.ts)   │
     │ NestJS HTTP app: AppModule   │        │ Nest app context: WorkerModule│
     │  • helmet, CORS, error filter│        │  • poll loop (skeleton)       │
     │  • /api/v1/health[/ready]    │        │  • graceful SIGTERM shutdown  │
     └──────────────┬───────────────┘        └──────────────┬───────────────┘
                    │  same codebase and repositories (ADR-001)│
                    │  each process: own pg pool (Kysely)      │
                    └──────────────────┬─────────────────────┘
                                       ▼
                         ┌──────────────────────────┐
                         │ PostgreSQL 17            │  system of record + job queue
                         │ (Docker locally;         │  (schema: Phase 1, queue logic: Phase 9)
                         │  Supabase in demo)       │
                         └──────────────────────────┘

  Planned: Cloudflare R2 (documents, Phase 4) · Tesseract OCR (Phase 6) ·
           Ollama / Cloudflare Workers AI behind an AI provider interface (Phase 7)
```

In the zero-cost demo deployment the worker runs inside the API's process (ADR-009). The code
already keeps the two separate so either topology works.

## Code layout

```text
apps/api/src
├── main.ts                  HTTP entrypoint
├── worker.ts                Worker entrypoint
├── app.module.ts            Root module for HTTP: shared feature modules + HTTP-facing modules
├── shared-feature-modules.ts  Feature modules imported by both root modules
├── config/                  Environment schema (Zod) and the global APP_CONFIG provider
├── database/                Kysely instance (DATABASE provider), migrations, migrate/seed CLIs,
│                            generated row types
├── users/ documents/ jobs/ extraction/ audit/
│                            Feature modules; today each holds its repository
├── common/                  Cross-cutting code usable by both processes
│   ├── bootstrap/           Startup failure handling
│   ├── filters/             HTTP exception → shared error envelope
│   └── logging/             Logger factory (JSON or pretty)
├── http/                    HTTP-only setup: helmet, CORS, prefix, filters, 404 handling
├── health/                  Liveness and readiness endpoints
└── worker/                  Worker-only: WorkerModule, WorkerService, PollingLoop

apps/web/src                 Phase 0 placeholder that checks API health
packages/shared/src          Zod schemas + types shared by API and web
```

Rules:

- Feature modules must not depend on `http/` or on Express, so the worker can import them without
  inheriting HTTP concerns.
- Only repositories touch Kysely. They take an optional executor so callers can group several calls
  in one transaction, and they return camelCase domain objects, never raw rows.
- Every repository read or delete of a user-owned resource filters by owner id in SQL.

## Key flows

### Startup (both processes)

1. `loadConfig(process.env)` validates every variable with Zod. On failure the process prints which
   variables are invalid (never their values) and exits with code 1.
2. The logger is created from config: JSON lines when `LOG_FORMAT=json`, readable output otherwise.
3. Nest boots the process's root module. The validated config is injected as `APP_CONFIG`.
4. Shutdown hooks are enabled. On SIGTERM/SIGINT Nest runs, in order: `beforeApplicationShutdown`
   (the worker stops polling and finishes its in-flight tick), closes the HTTP server (in-flight
   requests finish), then `onApplicationShutdown` (the database pool closes). This order means no
   running work loses its database connection mid-flight.

### HTTP request

`helmet` security headers → CORS (allow-list from `CORS_ALLOWED_ORIGINS`) → paths outside `/api/v1`
are rejected as 404 → body parsing → controller → any thrown exception is mapped by
`AllExceptionsFilter` to:

```json
{ "error": { "code": "NOT_FOUND", "message": "…" } }
```

4xx messages are returned as-is. 5xx responses always carry a generic message, and the details are
logged server-side only.

### Health probes

- `GET /api/v1/health` (liveness) checks nothing external, so a database outage does not make the
  platform restart a healthy process.
- `GET /api/v1/health/ready` (readiness) runs `SELECT 1`. On failure it returns 503 in the standard
  error envelope; the cause is logged, not returned.

### Worker loop

`PollingLoop` calls `tick()`. If the tick reports work was found, it polls again immediately;
otherwise, or after an error, it waits `WORKER_POLL_INTERVAL_MS`. Ticks never overlap. On shutdown
the idle wait is interrupted at once, but an in-flight tick is allowed to finish. In Phase 0 the
tick does nothing; Phase 9 makes it claim and process one job.

## API conventions (established)

- All endpoints are under `/api/v1`.
- Responses and request bodies are described by Zod schemas in `packages/shared`.
- Errors use the envelope above; error `code` is the HTTP status name.

## Configuration

See the environment variable table in the [README](../../README.md#environment-variables).
