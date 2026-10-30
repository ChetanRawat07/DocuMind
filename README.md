# DocuMind

An AI document intelligence platform: upload invoices, contracts and purchase orders; DocuMind
extracts text (with OCR for scans), classifies the document, extracts structured fields with an
LLM, validates them against schemas and flags low-confidence results for human review.

> **Portfolio/demo project.** Do not upload real confidential, medical, legal, financial or
> otherwise sensitive documents. Use synthetic documents. DocuMind makes no compliance claims
> (SOC 2, ISO 27001, HIPAA, GDPR) and has not been independently security-tested.

## Status

Built in phases (see `DocuMind_Interview_Ready_Development_Plan.md`).
**Phases 0 (foundation), 1 (database and data model), 2 (authentication and authorization) and 3
(UI foundation) are complete.** The following exist today:

- NestJS API process with liveness and readiness endpoints, security headers, CORS allow-list and
  a consistent error format.
- PostgreSQL schema (users, documents, processing jobs, extractions, audit logs) with migrations,
  constraints that enforce ownership, idempotency and job-state invariants, generated row types,
  repositories, a development seed and database integration tests.
- Authentication with Supabase Auth: sign-up, sign-in, sign-out and password reset in the web app;
  every API route requires a verified access token unless explicitly public; users are provisioned
  on first request; document endpoints enforce ownership (another user's document is a 404).
- Worker process skeleton with a graceful-shutdown poll loop (no job processing yet).
- Shared Zod contracts used by both API and web.
- React + Vite + Tailwind web app with the product shell: sidebar (a drawer on phones), top bar
  with breadcrumb and account menu, a dashboard (recent documents from the API; metrics show
  "No data yet" until analytics exists), settings, styled auth pages, and placeholder pages for
  sections built in later phases. A small component kit covers cards, status badges, and loading,
  empty and error states, with automated accessibility tests.
- Local PostgreSQL via Docker Compose, validated configuration, linting, formatting and tests.

Not built yet: uploads, storage, OCR, AI extraction, job processing, review workflow, analytics,
and the document, processing, review, analytics and audit-log screens.

## Architecture

A modular monolith: one NestJS codebase with two entrypoints (HTTP API and worker), PostgreSQL as
both system of record and job queue, and object storage for files. See:

- [Architecture overview](docs/architecture/overview.md)
- [Architecture decision records](docs/adr/README.md)
- [Database schema](docs/database/schema.md)
- [Authentication and authorization](docs/security/authentication.md)
- [UI foundation](docs/frontend/ui-foundation.md)

## Tech stack

| Area           | Technology                                     | Status                         |
| -------------- | ---------------------------------------------- | ------------------------------ |
| Frontend       | React 19, Vite 8, Tailwind CSS 4, TypeScript   | In use                         |
| UI             | Hand-built kit, lucide-react icons, Inter      | In use                         |
| Backend        | NestJS 12 (Express), TypeScript                | Scaffolded                     |
| Contracts      | Zod 4 (`packages/shared`)                      | In use                         |
| Database       | PostgreSQL 17 (Docker locally, Supabase later) | Schema and migrations in place |
| Data access    | Kysely, `pg`, kysely-codegen                   | In use                         |
| Auth           | Supabase Auth, supabase-js, `jose` (JWKS)      | In use                         |
| Routing (web)  | React Router                                   | In use                         |
| Job queue      | PostgreSQL (`FOR UPDATE SKIP LOCKED`)          | Schema ready; logic in Phase 9 |
| Object storage | Cloudflare R2                                  | Planned, Phase 4               |
| OCR            | Tesseract                                      | Planned, Phase 6               |
| AI             | Ollama (local), Cloudflare Workers AI (demo)   | Planned, Phase 7               |
| Tests          | Vitest, Supertest, Testing Library, axe-core   | In use                         |
| Lint/format    | ESLint (typescript-eslint strict), Prettier    | In use                         |

## Repository layout

```text
apps/
  api/        NestJS app: src/main.ts (HTTP API), src/worker.ts (worker)
  web/        React web client
packages/
  shared/     Zod schemas and types shared by api and web
docs/
  architecture/   System overview
  adr/            Architecture decision records
  database/       Schema, ERD, query patterns, indexes
  security/       Authentication and authorization
  frontend/       Design tokens, components, layout, accessibility
docker-compose.yml  Local infrastructure (PostgreSQL)
```

## Local setup

**Prerequisites:** Node.js 24 (`.nvmrc`), npm 11, Docker with Compose v2, and a free Supabase
project for signing in (see [Authentication setup](#authentication-setup); tests do not need one).

```bash
cp .env.example .env     # local defaults; edit if ports clash
npm install
npm run infra:up         # start PostgreSQL and wait until it is healthy
npm run db:migrate       # apply database migrations
npm run db:seed          # optional: demo user and documents
npm run dev              # shared (watch) + API + worker + web
```

Then open <http://localhost:5173>, create an account and sign in. Settings → Service status
shows "API online" when the web app can reach the API through the Vite proxy. The API's liveness endpoint is <http://localhost:3000/api/v1/health>, and
its readiness endpoint (which checks the database) is <http://localhost:3000/api/v1/health/ready>.

Stop infrastructure with `npm run infra:down` (data persists in the `postgres-data` volume; add
`-v` to `docker compose down` to delete it).

### Authentication setup

1. Create a free project at <https://supabase.com>.
2. In `.env`, set `SUPABASE_URL` and `VITE_SUPABASE_URL` to the project URL, and
   `VITE_SUPABASE_PUBLISHABLE_KEY` to the publishable (or legacy anon) key. Never use the secret or
   `service_role` key in the web app.
3. Make sure the project signs tokens with an **asymmetric JWT signing key** (Dashboard → Settings
   → JWT Keys). The API rejects tokens signed with the legacy shared secret.
4. Under Authentication → URL Configuration, set the Site URL to `http://localhost:5173` and allow
   the redirect URLs `http://localhost:5173/login` and `http://localhost:5173/reset-password`.

Details, including recommended hardening, are in
[docs/security/authentication.md](docs/security/authentication.md#supabase-project-setup-manual-once).

### Scripts (repository root)

| Script                     | What it does                                               |
| -------------------------- | ---------------------------------------------------------- |
| `npm run dev`              | Builds shared, then runs shared watch, API, worker and web |
| `npm run build`            | Production build of all packages                           |
| `npm run check`            | Format check, lint, typecheck and all tests                |
| `npm test`                 | All tests (database tests need `npm run infra:up`)         |
| `npm run lint`             | ESLint                                                     |
| `npm run format`           | Prettier write                                             |
| `npm run typecheck`        | TypeScript in every package                                |
| `npm run infra:up`         | Start local PostgreSQL and wait for healthy                |
| `npm run infra:down`       | Stop local infrastructure                                  |
| `npm run db:migrate`       | Apply pending migrations                                   |
| `npm run db:rollback`      | Revert the most recent migration                           |
| `npm run db:reset`         | Revert all migrations (refused in production)              |
| `npm run db:seed`          | Insert demo data (idempotent; refused in production)       |
| `npm run db:codegen`       | Regenerate row types from the migrated database            |
| `npm run db:codegen:check` | Fail if generated row types differ from the database       |

Run a single process with `npm run start -w @documind/api` (API) or
`npm run start:worker -w @documind/api` (worker) after `npm run build`.

### Tests

API tests are split into two Vitest projects:

- `unit`: no external services.
- Authentication tests sign tokens with a locally generated key pair, so no Supabase project is
  needed.
- `integration`: runs against `TEST_DATABASE_URL`. The suite **drops and recreates** that database
  on every run and refuses any database name that does not end in `_test`.

Run one project with `npx vitest run --project unit` (or `integration`) inside `apps/api`.

## Environment variables

Validated at startup by `apps/api/src/config/app-config.ts`; an invalid value stops the process
with a message naming the variable.

| Variable                        | Default         | Used by                          | Description                                                              |
| ------------------------------- | --------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`                      | `development`   | API, worker                      | `development`, `test` or `production`                                    |
| `LOG_LEVEL`                     | `log`           | API, worker                      | Minimum level: `verbose`, `debug`, `log`, `warn`, `error`, `fatal`       |
| `LOG_FORMAT`                    | `json`          | API, worker                      | `json` (structured) or `pretty` (local)                                  |
| `PORT`                          | `3000`          | API, web dev proxy               | HTTP port of the API                                                     |
| `CORS_ALLOWED_ORIGINS`          | empty           | API                              | Comma-separated bare origins; empty disables cross-origin access         |
| `WORKER_POLL_INTERVAL_MS`       | `5000`          | Worker                           | Wait after an empty poll (100–60000)                                     |
| `DATABASE_URL`                  | none (required) | API, worker, CLIs                | `postgres://` URL of the application database; contains credentials      |
| `DATABASE_POOL_MAX`             | `10`            | API, worker                      | Connections per process (1–50)                                           |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `30000`         | API, worker                      | Server-side limit per statement (1000–300000)                            |
| `TEST_DATABASE_URL`             | none            | Integration tests                | Database recreated by the test suite; name must end in `_test`           |
| `SUPABASE_URL`                  | none (required) | API (validated in all processes) | Supabase project URL; https (http only for localhost outside production) |
| `VITE_SUPABASE_URL`             | none (required) | Web (public)                     | Supabase project URL for the browser                                     |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | none (required) | Web (public)                     | Publishable/anon key; public by design                                   |
| `POSTGRES_USER`                 | none            | Docker Compose                   | Local database user (required by Compose)                                |
| `POSTGRES_PASSWORD`             | none            | Docker Compose                   | Local database password (required by Compose)                            |
| `POSTGRES_DB`                   | none            | Docker Compose                   | Local database name (required by Compose)                                |
| `POSTGRES_PORT`                 | `5432`          | Docker Compose                   | Host port, bound to 127.0.0.1                                            |

## API

| Method | Path                    | Auth   | Description                                                                        |
| ------ | ----------------------- | ------ | ---------------------------------------------------------------------------------- |
| GET    | `/api/v1/health`        | None   | Liveness: `{ "status": "ok", "timestamp" }`                                        |
| GET    | `/api/v1/health/ready`  | None   | Readiness: same body when the database answers; 503 otherwise                      |
| GET    | `/api/v1/me`            | Bearer | The signed-in user; creates the user record on first call                          |
| GET    | `/api/v1/documents`     | Bearer | The caller's documents, newest first; `limit` (1–100, default 20), opaque `cursor` |
| GET    | `/api/v1/documents/:id` | Bearer | One of the caller's documents; 404 for other users' and unknown ids                |

All errors use `{ "error": { "code": "<HTTP_STATUS_NAME>", "message": "…" } }`. Server errors
never include internal details. Authenticated endpoints return 401 (with `WWW-Authenticate`) for a
missing, invalid or expired token, and 503 if Supabase's signing keys cannot be fetched.

## Troubleshooting

- **`required variable POSTGRES_USER is missing a value`**: create `.env` from `.env.example`.
- **Port 5432, 3000 or 5173 already in use**: change `POSTGRES_PORT` or `PORT` in `.env`; Vite picks
  the next free port automatically.
- **Settings shows "API unreachable"**: check the API process output in `npm run dev`. The proxy
  targets `localhost:$PORT`.
- **`Failed to start: Invalid environment configuration`**: the message lists each invalid variable.
- **`Failed to start: listen EADDRINUSE`**: another process uses `PORT`; change it in `.env`.
- **`TEST_DATABASE_URL is not set`**: add it to `.env` (see `.env.example`).
- **Readiness returns 503**: the API cannot reach `DATABASE_URL`; the API log has the cause.
- **Web app shows "Missing or invalid web configuration"**: set the `VITE_SUPABASE_*` variables in
  `.env` and restart `npm run dev`.
- **Every API call returns 401 "Invalid access token" after signing in**: `SUPABASE_URL` does not
  match the project the web app signs in to, or the project still uses the legacy HS256 secret.
- **API calls return 503 after signing in**: the API cannot fetch the JWKS; the API log names the
  cause (check `SUPABASE_URL` and network access).
- **Password reset link opens the login page or says "Link expired"**: add
  `http://localhost:5173/reset-password` to the Supabase redirect allow-list, and open the link in
  the browser that requested it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch, commit and review conventions.
