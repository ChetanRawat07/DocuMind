# DocuMind

An AI document intelligence platform: upload invoices, contracts and purchase orders; DocuMind
extracts text (with OCR for scans), classifies the document, extracts structured fields with an
LLM, validates them against schemas and flags low-confidence results for human review.

> **Portfolio/demo project.** Do not upload real confidential, medical, legal, financial or
> otherwise sensitive documents. Use synthetic documents. DocuMind makes no compliance claims
> (SOC 2, ISO 27001, HIPAA, GDPR) and has not been independently security-tested.

## Status

Built in phases (see `DocuMind_Interview_Ready_Development_Plan.md`).
**Phase 0 (project foundation) is complete.** The following exist today:

- NestJS API process with a liveness endpoint, security headers, CORS allow-list and a consistent
  error format.
- Worker process skeleton with a graceful-shutdown poll loop (no job processing yet).
- Shared Zod contracts used by both API and web.
- React + Vite + Tailwind placeholder page that checks API health.
- Local PostgreSQL via Docker Compose, validated configuration, linting, formatting and tests.

Not built yet: database schema, authentication, uploads, storage, OCR, AI extraction, job
processing, review workflow, analytics and the product UI.

## Architecture

A modular monolith: one NestJS codebase with two entrypoints (HTTP API and worker), PostgreSQL as
both system of record and job queue, and object storage for files. See:

- [Architecture overview](docs/architecture/overview.md)
- [Architecture decision records](docs/adr/README.md)

## Tech stack

| Area           | Technology                                     | Status                         |
| -------------- | ---------------------------------------------- | ------------------------------ |
| Frontend       | React 19, Vite 8, Tailwind CSS 4, TypeScript   | Scaffolded                     |
| Backend        | NestJS 12 (Express), TypeScript                | Scaffolded                     |
| Contracts      | Zod 4 (`packages/shared`)                      | In use                         |
| Database       | PostgreSQL 17 (Docker locally, Supabase later) | Running locally; no schema yet |
| Job queue      | PostgreSQL (`FOR UPDATE SKIP LOCKED`)          | Planned, Phase 9               |
| Object storage | Cloudflare R2                                  | Planned, Phase 4               |
| OCR            | Tesseract                                      | Planned, Phase 6               |
| AI             | Ollama (local), Cloudflare Workers AI (demo)   | Planned, Phase 7               |
| Tests          | Vitest, Supertest, Testing Library             | In use                         |
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
docker-compose.yml  Local infrastructure (PostgreSQL)
```

## Local setup

**Prerequisites:** Node.js 24 (`.nvmrc`), npm 11, Docker with Compose v2.

```bash
cp .env.example .env     # local defaults; edit if ports clash
npm install
npm run infra:up         # start PostgreSQL and wait until it is healthy
npm run dev              # shared (watch) + API + worker + web
```

Then open <http://localhost:5173>. The page shows "API online" when the web app can reach the API
through the Vite proxy. The API's liveness endpoint is <http://localhost:3000/api/v1/health>.

Stop infrastructure with `npm run infra:down` (data persists in the `postgres-data` volume; add
`-v` to `docker compose down` to delete it).

### Scripts (repository root)

| Script               | What it does                                               |
| -------------------- | ---------------------------------------------------------- |
| `npm run dev`        | Builds shared, then runs shared watch, API, worker and web |
| `npm run build`      | Production build of all packages                           |
| `npm run check`      | Format check, lint, typecheck and all tests                |
| `npm test`           | All tests                                                  |
| `npm run lint`       | ESLint                                                     |
| `npm run format`     | Prettier write                                             |
| `npm run typecheck`  | TypeScript in every package                                |
| `npm run infra:up`   | Start local PostgreSQL and wait for healthy                |
| `npm run infra:down` | Stop local infrastructure                                  |

Run a single process with `npm run start -w @documind/api` (API) or
`npm run start:worker -w @documind/api` (worker) after `npm run build`.

## Environment variables

Validated at startup by `apps/api/src/config/app-config.ts`; an invalid value stops the process
with a message naming the variable.

| Variable                  | Default       | Used by            | Description                                                        |
| ------------------------- | ------------- | ------------------ | ------------------------------------------------------------------ |
| `NODE_ENV`                | `development` | API, worker        | `development`, `test` or `production`                              |
| `LOG_LEVEL`               | `log`         | API, worker        | Minimum level: `verbose`, `debug`, `log`, `warn`, `error`, `fatal` |
| `LOG_FORMAT`              | `json`        | API, worker        | `json` (structured) or `pretty` (local)                            |
| `PORT`                    | `3000`        | API, web dev proxy | HTTP port of the API                                               |
| `CORS_ALLOWED_ORIGINS`    | empty         | API                | Comma-separated bare origins; empty disables cross-origin access   |
| `WORKER_POLL_INTERVAL_MS` | `5000`        | Worker             | Wait after an empty poll (100–60000)                               |
| `POSTGRES_USER`           | none          | Docker Compose     | Local database user (required by Compose)                          |
| `POSTGRES_PASSWORD`       | none          | Docker Compose     | Local database password (required by Compose)                      |
| `POSTGRES_DB`             | none          | Docker Compose     | Local database name (required by Compose)                          |
| `POSTGRES_PORT`           | `5432`        | Docker Compose     | Host port, bound to 127.0.0.1                                      |

## API

| Method | Path             | Auth | Description                                 |
| ------ | ---------------- | ---- | ------------------------------------------- |
| GET    | `/api/v1/health` | None | Liveness: `{ "status": "ok", "timestamp" }` |

All errors use `{ "error": { "code": "<HTTP_STATUS_NAME>", "message": "…" } }`. Server errors
never include internal details.

## Troubleshooting

- **`required variable POSTGRES_USER is missing a value`**: create `.env` from `.env.example`.
- **Port 5432, 3000 or 5173 already in use**: change `POSTGRES_PORT` or `PORT` in `.env`; Vite picks
  the next free port automatically.
- **Web page says "API unreachable"**: check the API process output in `npm run dev`. The proxy
  targets `localhost:$PORT`.
- **`Failed to start: Invalid environment configuration`**: the message lists each invalid variable.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch, commit and review conventions.
