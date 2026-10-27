# Architecture overview

This document describes the architecture **as implemented** and marks planned parts explicitly.
Decisions and their reasoning live in [the ADRs](../adr/README.md).

## Current state: Phase 0 (foundation)

Implemented: repository structure, the API process with a liveness endpoint, the worker process
skeleton, shared contracts, local PostgreSQL, configuration validation, linting, formatting and
tests. Not yet implemented: database schema, authentication, uploads, storage, OCR, AI, job
processing, and the product UI.

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
     │  • /api/v1/health            │        │  • graceful SIGTERM shutdown  │
     └──────────────┬───────────────┘        └──────────────┬───────────────┘
                    │        same codebase: apps/api         │
                    └──────────────────┬─────────────────────┘
                                       ▼
                         ┌──────────────────────────┐
                         │ PostgreSQL 17            │  system of record + job queue
                         │ (Docker locally;         │  (schema: Phase 1, queue: Phase 9)
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
├── app.module.ts            Root module for HTTP: config + HTTP-facing modules
├── config/                  Environment schema (Zod) and the global APP_CONFIG provider
├── common/                  Cross-cutting code usable by both processes
│   ├── bootstrap/           Startup failure handling
│   ├── filters/             HTTP exception → shared error envelope
│   └── logging/             Logger factory (JSON or pretty)
├── http/                    HTTP-only setup: helmet, CORS, prefix, filters, 404 handling
├── health/                  Liveness endpoint
└── worker/                  Worker-only: WorkerModule, WorkerService, PollingLoop

apps/web/src                 Phase 0 placeholder that checks API health
packages/shared/src          Zod schemas + types shared by API and web
```

Rule: feature modules added in later phases (documents, jobs, storage and so on) must not depend on
`http/` or on Express, so the worker can import them without inheriting HTTP concerns.

## Key flows

### Startup (both processes)

1. `loadConfig(process.env)` validates every variable with Zod. On failure the process prints which
   variables are invalid (never their values) and exits with code 1.
2. The logger is created from config: JSON lines when `LOG_FORMAT=json`, readable output otherwise.
3. Nest boots the process's root module. The validated config is injected as `APP_CONFIG`.
4. Shutdown hooks are enabled, so SIGTERM/SIGINT run `onApplicationShutdown` handlers.

### HTTP request

`helmet` security headers → CORS (allow-list from `CORS_ALLOWED_ORIGINS`) → paths outside `/api/v1`
are rejected as 404 → body parsing → controller → any thrown exception is mapped by
`AllExceptionsFilter` to:

```json
{ "error": { "code": "NOT_FOUND", "message": "…" } }
```

4xx messages are returned as-is. 5xx responses always carry a generic message, and the details are
logged server-side only.

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
