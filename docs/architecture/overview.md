# Architecture overview

This document describes the architecture **as implemented** and marks planned parts explicitly.
Decisions and their reasoning live in [the ADRs](../adr/README.md).

## Current state: Phase 4 (document upload and object storage)

Implemented: repository structure, the API process with liveness and readiness endpoints, the
worker process skeleton, shared contracts, configuration validation, the PostgreSQL schema with
migrations, repositories for every table, a development seed, Supabase Auth integration (sign-up,
sign-in, sign-out, password reset in the web app; token verification, a global auth guard and user
provisioning in the API), read-only document endpoints with ownership enforcement, the web app's product shell and component
kit (dashboard, settings, placeholder pages for later sections), and unit, integration, component
and accessibility tests, and document upload/delete with content validation and private object
storage (filesystem adapter locally, S3-compatible adapter for R2). Not yet implemented: OCR, AI,
job processing, document search/detail/download, and the processing, review, analytics and
audit-log screens.

- Schema, constraints and indexes: [database/schema.md](../database/schema.md)
- Authentication and authorization: [security/authentication.md](../security/authentication.md)
- Web UI (tokens, components, layout, accessibility): [frontend/ui-foundation.md](../frontend/ui-foundation.md)
- Uploads, storage keys and storage/database consistency: [storage/document-uploads.md](../storage/document-uploads.md)

## Runtime view

```text
                 Browser ─────────────────────────────▶ Supabase Auth
                    │                     sign-in/up, refresh, reset (supabase-js)
                    ▼
     ┌──────────────────────────────┐
     │ apps/web (React + Vite)      │   dev: Vite server proxies /api → API
     └──────────────┬───────────────┘   demo: Cloudflare Pages (Phase 16)
                    │ HTTPS /api/v1/*  Authorization: Bearer <access token>
                    ▼
     ┌──────────────────────────────┐        ┌──────────────────────────────┐
     │ API process  (main.ts)       │        │ Worker process (worker.ts)   │
     │ NestJS HTTP app: AppModule   │        │ Nest app context: WorkerModule│
     │  • helmet, CORS, error filter│
     │  • global auth guard (JWKS)  │        │  • poll loop (skeleton)       │
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

  Object storage (ObjectStorage adapter): local folder in development, Cloudflare R2 in the demo;
  only the API touches it, the browser never does.
  Planned: Tesseract OCR (Phase 6) ·
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
├── auth/                    HTTP-only: token verifier, global AuthGuard, @Public(), @CurrentUser(),
│                            user provisioning
├── shared-feature-modules.ts  Feature modules imported by both root modules
├── config/                  Environment schema (Zod) and the global APP_CONFIG provider
├── database/                Kysely instance (DATABASE provider), migrations, migrate/seed CLIs,
│                            generated row types
├── users/ documents/ jobs/ extraction/ audit/
│                            Feature modules; each holds its repository. `*-http.module.ts`
│                            files hold controllers and are imported by AppModule only
├── common/                  Cross-cutting code usable by both processes
│   ├── bootstrap/           Startup failure handling
│   ├── filters/             HTTP exception → shared error envelope
│   ├── pipes/               Zod validation pipe for request input
│   └── logging/             Logger factory (JSON or pretty)
├── http/                    HTTP-only setup: helmet, CORS, prefix, filters, 404 handling
├── health/                  Liveness and readiness endpoints
└── worker/                  Worker-only: WorkerModule, WorkerService, PollingLoop

apps/web/src
├── auth/                    Supabase client, AuthProvider, useAuth, RequireAuth, safe redirects,
│                            current-user context
├── layout/                  App shell, sidebar, mobile drawer, top bar, account menu, nav config
├── pages/                   Auth pages, dashboard, settings, coming-soon and not-found pages
├── components/ui/           Component kit: button, card, page header, badges, charts, states
├── components/documents/    Document table
├── lib/                     Formatting, labels and small pure helpers
├── services/                API client (bearer token, refresh-once-on-401), useApiQuery, health
└── test/                    Fake auth client and app render helpers
packages/shared/src          Zod schemas + types shared by API and web
```

Rules:

- Feature modules must not depend on `http/` or on Express, so the worker can import them without
  inheriting HTTP concerns.
- Only repositories touch Kysely. They take an optional executor so callers can group several calls
  in one transaction, and they return camelCase domain objects, never raw rows.
- Every repository read or delete of a user-owned resource filters by owner id in SQL.
- Every route requires authentication unless marked `@Public()`. Controllers get the caller from
  `@CurrentUser()` and pass its id to the repositories; they never check ownership after loading a
  row.

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
are rejected as 404 → `Cache-Control: no-store` → body parsing → global `AuthGuard` (verifies the
bearer token, provisions the user; skipped for `@Public()` routes) → pipes (UUID, Zod) →
controller → any thrown exception is mapped by
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
- Authentication: `Authorization: Bearer <Supabase access token>`; 401 with `WWW-Authenticate` when
  missing or invalid, 503 when signing keys cannot be fetched.
- Another user's resource and a nonexistent one both return 404 with the same body.
- Lists use keyset pagination with an opaque `cursor` and `limit` (default 20, max 100).

## Configuration

See the environment variable table in the [README](../../README.md#environment-variables).
