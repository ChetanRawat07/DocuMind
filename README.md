# DocuMind

An AI document intelligence platform. Upload an invoice, purchase order or contract: DocuMind reads
its text (with OCR for scans), classifies it, extracts structured fields with an LLM, checks them
against business rules and the document's own text, and sends anything it is unsure about to a
person for review.

> **Portfolio/demo project.** Do not upload real confidential, medical, legal, financial or
> otherwise sensitive documents. Use synthetic documents. Document text is sent to the configured
> AI provider. DocuMind makes no compliance claims (SOC 2, ISO 27001, HIPAA, GDPR) and has not been
> independently security-tested.

**Contents:** [Features](#features) · [Architecture](#architecture) · [Tech stack](#tech-stack) ·
[Local setup](#local-setup) · [Environment variables](#environment-variables) ·
[Security model](#security-model) · [API](#api) · [Deployment](#deployment) ·
[Free-tier constraints](#free-tier-constraints) · [Limitations](#limitations) ·
[Troubleshooting](#troubleshooting) · [Documentation](#documentation)

## Features

- **Upload:** drag and drop PDF, PNG or JPEG files up to 10 MiB, with per-file progress. The API
  checks each file's actual bytes, not its name or declared type, and stores it privately.
- **Text extraction:** a PDF's text layer where it has one, OCR (Tesseract) for scanned pages and
  images. Text is kept per page with its method and OCR confidence.
- **Classification and extraction:** the model names the document type, then extracts that type's
  fields, each with the passage it came from. Answers are constrained to a JSON Schema and
  validated.
- **Evidence-based confidence:** each field is scored by checks, not by the model's self-report.
  Is the quoted passage really in the document, does it contain the value, was the OCR good, do
  totals and dates add up? Text-layer values must also be visible on the rendered page.
- **Review workflow:** confident extractions complete on their own. The rest wait for a person,
  who confirms or corrects each flagged field and then approves or rejects the document.
  Corrections are stored apart from the model's output.
- **Asynchronous processing:** uploads queue a job. A worker processes it with retries, backoff
  and a dead letter, takes over a crashed worker's job, and fences out stale writes.
- **Documents:** search by filename, filters, six sort orders with keyset pagination, preview,
  download and delete.
- **Observability:** a request id that follows each upload through its job, the worker and the AI
  calls. Structured JSON logs, step timings, and Processing, Audit Logs and per-document activity
  screens.
- **Analytics:** volume, success and failure rates, processing time, confidence, review and
  correction rates over 7, 30 or 90 days, in the viewer's timezone.
- **Privacy and abuse controls:** owner-only access everywhere, an audit log without document
  content, per-user rate limits, a daily processing quota, and "Delete all my data".
- **Engineering:** 1,000+ automated tests with coverage thresholds and mutation checks, a
  performance review at 1 million documents, and CI that gates every deploy.

## Architecture

A modular monolith: one NestJS codebase with two entrypoints, the HTTP API and the worker.
PostgreSQL is both the system of record and the job queue, and files live in object storage.

```text
             Browser (React app)  ───── sign-up, sign-in, refresh ─────▶  Supabase Auth
                 │  HTTPS, Authorization: Bearer <access token>                │ JWKS
                 ▼                                                             ▼
   ┌───────────────────────────────┐                        ┌───────────────────────────────┐
   │ API  (apps/api/src/main.ts)   │                        │ Worker (apps/api/src/worker.ts)│
   │ auth guard: verify token      │                        │ poll: claim job (SKIP LOCKED)  │
   │ ownership checks, rate limits │                        │ 1. text: pdf.js / Tesseract    │
   │ upload: check bytes, store,   │                        │ 2. AI: classify, extract       │
   │   queue job in one transaction│                        │ 3. score evidence, validate    │
   │ review, documents, analytics  │                        │ 4. complete or send to review  │
   └──────┬─────────────────┬──────┘                        └──────┬──────────────┬──────────┘
          │                 │                                      │              │
          │                 ▼                                      ▼              ▼
          │      ┌──────────────────────┐   ◀── jobs, rows ──  same database   AI provider
          │      │ PostgreSQL           │                                     Ollama (local)
          │      │ documents, jobs,     │                                     Workers AI (demo)
          │      │ texts, extractions,  │
          │      │ reviews, audit log   │
          │      └──────────────────────┘
          ▼
   Object storage: a local folder in development, a private Cloudflare R2 bucket in the demo.
   Only the API and the worker touch it; the browser never does.
```

In the free demo the worker runs inside the API process, because the free host has no background
workers (ADR-009). Details: [architecture overview](docs/architecture/overview.md) and the
[architecture decision records](docs/adr/README.md).

## Tech stack

| Area           | Technology                                                     |
| -------------- | -------------------------------------------------------------- |
| Web app        | React 19, Vite 8, Tailwind CSS 4, React Router, TypeScript     |
| UI             | Hand-built component kit, lucide-react icons, Inter            |
| API and worker | NestJS 12 (Express), TypeScript, Node.js 24                    |
| Contracts      | Zod 4 schemas shared by the API and the web app                |
| Database       | PostgreSQL 17: Docker locally, Supabase in the demo            |
| Data access    | Kysely, `pg`, SQL migrations, generated row types              |
| Authentication | Supabase Auth, supabase-js, `jose` (JWKS verification)         |
| Job queue      | PostgreSQL table, `FOR UPDATE SKIP LOCKED`                     |
| Object storage | Local folder (development), Cloudflare R2 through AWS SDK v3   |
| Text and OCR   | pdf.js text layer, tesseract.js (WebAssembly), @napi-rs/canvas |
| AI             | Ollama with `qwen2.5:3b` (local), Cloudflare Workers AI (demo) |
| Tests          | Vitest, Supertest, Testing Library, axe-core                   |
| Tooling        | npm workspaces, ESLint (typescript-eslint strict), Prettier    |
| Delivery       | Docker, GitHub Actions, Render, Cloudflare Pages               |

## Repository layout

```text
apps/
  api/          NestJS: src/main.ts (HTTP API), src/worker.ts (worker), src/cli/ (tools),
                src/database/migrations/, test/ (HTTP and database tests)
  web/          React web app; public/_headers (host security headers)
packages/
  shared/       Zod contracts used by the API and the web app
docs/           Architecture, ADRs, API, database, security, processing, operations
.github/workflows/ci.yml   Checks, image smoke test, web deploy
Dockerfile, render.yaml    API image and its Render service
docker-compose.yml         Local PostgreSQL, and Ollama with the `ai` profile
```

## Local setup

**Prerequisites:** Node.js 24 (`.nvmrc`) with npm 11, Docker with Compose v2, and a free Supabase
project for signing in (see [Authentication](#authentication)). The tests need no Supabase project.

```bash
cp .env.example .env     # local defaults; edit if ports clash
npm install
npm run infra:up         # start PostgreSQL and wait until it is healthy
npm run db:migrate       # create the schema
npm run db:seed          # optional: a demo user with sample documents
npm run ai:up            # optional: local AI model, needed to process documents (below)
npm run dev              # shared (watch) + API + worker + web
```

Open <http://localhost:5173>, create an account and sign in. Settings → Service status shows "API
online" when the web app reaches the API. The API's liveness endpoint is
<http://localhost:3000/api/v1/health>, and its readiness endpoint, which checks the database, is
<http://localhost:3000/api/v1/health/ready>.

### Database

PostgreSQL 17 runs in Docker, bound to `127.0.0.1` only. Its data persists in the `postgres-data`
volume.

| Task                  | Command                                                 |
| --------------------- | ------------------------------------------------------- |
| Apply migrations      | `npm run db:migrate`                                    |
| Revert the latest one | `npm run db:rollback`                                   |
| Revert all            | `npm run db:reset` (refused when `NODE_ENV=production`) |
| Demo data             | `npm run db:seed` (idempotent; refused in production)   |
| Regenerate row types  | `npm run db:codegen` after adding a migration           |
| Check row types       | `npm run db:codegen:check` (CI runs it)                 |
| Delete all local data | `docker compose down -v`                                |

- Migrations are TypeScript files in `apps/api/src/database/migrations/`, registered in its
  `index.ts`. In production they must stay backward compatible: the new version migrates while the
  old one still serves ([deployment](docs/operations/deployment.md#releases-and-migrations)).
- The integration tests use a separate database (`TEST_DATABASE_URL`). The suite drops and
  recreates it on every run, and refuses any name that does not end in `_test`.
- Tables, constraints, indexes and query patterns: [database schema](docs/database/schema.md).

### Docker

| What                 | How                                                                            |
| -------------------- | ------------------------------------------------------------------------------ |
| Local PostgreSQL     | `npm run infra:up` / `npm run infra:down` (`docker-compose.yml`)               |
| Local Ollama         | `npm run ai:up` (Compose profile `ai`; downloads the model once into a volume) |
| Production API image | `docker build -t documind-api .` from the repository root                      |

The application processes run on the host during development (`npm run dev`) for fast reloads.
The production image runs the migrations, then the API. To try it against local PostgreSQL, give it
production-like settings (S3 storage and an AI provider are required in production):

```sh
docker run --rm --network host --env-file <production-like env file> documind-api
```

### Authentication

1. Create a free project at <https://supabase.com>.
2. In `.env`, set `SUPABASE_URL` and `VITE_SUPABASE_URL` to the project URL, and
   `VITE_SUPABASE_PUBLISHABLE_KEY` to the publishable (or legacy anon) key. Never put the secret or
   `service_role` key in the web app.
3. Make sure the project signs tokens with an **asymmetric JWT signing key** (Dashboard → Settings
   → JWT Keys). The API rejects tokens signed with the legacy shared secret.
4. Under Authentication → URL Configuration, set the Site URL to `http://localhost:5173` and allow
   the redirect URLs `http://localhost:5173/login` and `http://localhost:5173/reset-password`.
5. Supabase's built-in mailer only sends to members of your Supabase team, and only two emails an
   hour. Sign up with your own address, or add users in the dashboard.

Details and hardening: [authentication](docs/security/authentication.md#supabase-project-setup-manual-once).

### AI

The worker calls an AI provider for classification and field extraction. `AI_PROVIDER` selects it.

- **Ollama (local, the default):** `npm run ai:up` starts Ollama in Docker, bound to `127.0.0.1`,
  and downloads `qwen2.5:3b` (about 2 GB, once). It runs on the CPU: a document takes a minute or
  more, so `AI_TIMEOUT_MS` defaults to 5 minutes. A GPU-enabled Ollama, or a larger model through
  `OLLAMA_MODEL`, also works.
- **Cloudflare Workers AI (demo):** set `AI_PROVIDER=cloudflare`, `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_AI_API_TOKEN` (a token with only the "Workers AI: Read" permission). Document text
  then leaves your machine.
- `npm run ai:check` runs one structured request through the configured provider.
  `npm run analyze -- <documentId>` classifies and extracts one document and prints the result
  without storing it.

Without a provider, uploads still work, and their jobs retry and then fail with an AI error code.
Details: [AI providers](docs/ai/ai-providers.md).

### OCR

There is nothing to install. pdf.js and Tesseract run as JavaScript and WebAssembly inside the
worker, and the English language data ships as an npm package, so OCR works offline.

- PDF pages with a text layer skip OCR. Scanned pages are rendered at 200 DPI and read with
  Tesseract. Images over A4 at 200 DPI are downscaled first, which bounds memory.
- Limits: 50 pages per PDF, 25 megapixels per image, English only.
- Speed: about 3 s per scanned page on one laptop core, and about 46 s on the free demo host.
- `npm run extract -- <documentId>` extracts one document's text by hand and prints counts.

Details: [text extraction](docs/processing/text-extraction.md).

### Queue

The job queue is a PostgreSQL table, so there is no broker to run.

- Uploading creates a `queued` job in the same transaction as the document.
- The worker claims the oldest due job with `FOR UPDATE SKIP LOCKED` under a lease (twice
  `AI_TIMEOUT_MS` plus 5 minutes, 15 minutes by default). It runs one job at a time.
- Failures are retryable or permanent. Retries back off with jitter (about 30 s, 1 min, 2 min,
  capped at 15 min), up to 3 attempts. Then the job is a dead letter, which the user can retry from
  the document page.
- A crashed worker's job is taken over when its lease expires.
- `npm run dev` runs one worker. Run more with `npm run start:worker -w @documind/api` after
  `npm run build`, or set `WORKER_IN_PROCESS=true` to run the loop inside the API process.
- `WORKER_POLL_INTERVAL_MS` (default 5 s) is the wait after finding no work.

Details, including the "what if" cases: [job queue](docs/processing/job-queue.md).

### Scripts (repository root)

| Script                     | What it does                                               |
| -------------------------- | ---------------------------------------------------------- |
| `npm run dev`              | Builds shared, then runs shared watch, API, worker and web |
| `npm run build`            | Production build of all packages                           |
| `npm run check`            | Format check, lint, typecheck and all tests                |
| `npm test`                 | All tests (database tests need `npm run infra:up`)         |
| `npm run test:coverage`    | All tests with coverage; fails below the thresholds        |
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
| `npm run ai:up`            | Start local Ollama (Docker) and download `qwen2.5:3b`      |
| `npm run ai:check`         | One structured round trip through the configured provider  |
| `npm run extract -- <id>`  | Extract a document's text by hand (the worker does it too) |
| `npm run analyze -- <id>`  | Classify and extract fields; prints, stores nothing        |
| `npm run storage:sweep`    | List stored files no document references (`-- --delete`)   |

### Tests

- **API:** two Vitest projects. `unit` needs no services. `integration` runs against
  `TEST_DATABASE_URL` (PostgreSQL from `npm run infra:up`). Run one with
  `npx vitest run --project unit` inside `apps/api`.
- **Web:** components and pages in jsdom with Testing Library, plus axe-core accessibility checks of
  every page.
- No test calls a live AI provider, Supabase or storage bucket. Authentication tests sign tokens
  with a locally generated key pair.
- Layers, fakes, coverage thresholds and mutation checks: [testing strategy](docs/testing/testing-strategy.md).

## Environment variables

Validated at startup by `apps/api/src/config/app-config.ts`; an invalid value stops the process
with a message naming the variable.

| Variable                        | Default                                    | Used by                          | Description                                                              |
| ------------------------------- | ------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`                      | `development`                              | API, worker                      | `development`, `test` or `production`                                    |
| `LOG_LEVEL`                     | `log`                                      | API, worker                      | Minimum level: `verbose`, `debug`, `log`, `warn`, `error`, `fatal`       |
| `LOG_FORMAT`                    | `json`                                     | API, worker                      | `json` (structured) or `pretty` (local)                                  |
| `PORT`                          | `3000`                                     | API, web dev proxy               | HTTP port of the API                                                     |
| `CORS_ALLOWED_ORIGINS`          | empty                                      | API                              | Comma-separated bare origins; empty disables cross-origin access         |
| `WORKER_POLL_INTERVAL_MS`       | `5000`                                     | Worker                           | Wait after an empty poll (100–60000)                                     |
| `WORKER_IN_PROCESS`             | `false`                                    | API                              | `true`: the API process also runs the poll loop (free host, ADR-009)     |
| `DATABASE_URL`                  | none (required)                            | API, worker, CLIs                | `postgres://` URL of the application database; contains credentials      |
| `DATABASE_POOL_MAX`             | `10`                                       | API, worker                      | Connections per process (1–50)                                           |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `30000`                                    | API, worker                      | Server-side limit per statement (1000–300000)                            |
| `TEST_DATABASE_URL`             | none                                       | Integration tests                | Database recreated by the test suite; name must end in `_test`           |
| `SUPABASE_URL`                  | none (required)                            | API (validated in all processes) | Supabase project URL; https (http only for localhost outside production) |
| `VITE_SUPABASE_URL`             | none (required)                            | Web (public)                     | Supabase project URL for the browser                                     |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | none (required)                            | Web (public)                     | Publishable/anon key; public by design                                   |
| `VITE_API_URL`                  | empty (same origin)                        | Web build (public)               | API origin when it is on another host; `https://host`, no path           |
| `STORAGE_DRIVER`                | `filesystem`                               | API, worker                      | `filesystem` (dev/tests; refused in production) or `s3` (R2)             |
| `STORAGE_FILESYSTEM_ROOT`       | `.data/storage`                            | API, worker                      | Folder for the filesystem driver, relative to the working directory      |
| `S3_ENDPOINT`                   | none                                       | API, worker (`s3` driver)        | e.g. `https://<account-id>.r2.cloudflarestorage.com`; https required     |
| `S3_REGION`                     | `auto`                                     | API, worker (`s3` driver)        | `auto` for R2                                                            |
| `S3_BUCKET`                     | none                                       | API, worker (`s3` driver)        | Private bucket name                                                      |
| `S3_ACCESS_KEY_ID`              | none                                       | API, worker (`s3` driver)        | R2 API token key id                                                      |
| `S3_SECRET_ACCESS_KEY`          | none                                       | API, worker (`s3` driver)        | Secret; server-side only, never logged                                   |
| `AI_PROVIDER`                   | `ollama`                                   | API, worker                      | `ollama` or `cloudflare`; required in production                         |
| `AI_TIMEOUT_MS`                 | `300000`                                   | API, worker                      | Per-request limit for the AI provider                                    |
| `OLLAMA_BASE_URL`               | `http://localhost:11434`                   | API, worker (`ollama`)           | https required in production unless localhost                            |
| `OLLAMA_MODEL`                  | `qwen2.5:3b`                               | API, worker (`ollama`)           | Must be pulled first (`npm run ai:up`)                                   |
| `CLOUDFLARE_ACCOUNT_ID`         | none                                       | API, worker (`cloudflare`)       | 32-character account id                                                  |
| `CLOUDFLARE_AI_API_TOKEN`       | none                                       | API, worker (`cloudflare`)       | Secret ("Workers AI: Read" only); server-side only, never logged         |
| `CLOUDFLARE_AI_MODEL`           | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | API, worker (`cloudflare`)       | Must support JSON mode                                                   |
| `POSTGRES_USER`                 | none                                       | Docker Compose                   | Local database user (required by Compose)                                |
| `POSTGRES_PASSWORD`             | none                                       | Docker Compose                   | Local database password (required by Compose)                            |
| `POSTGRES_DB`                   | none                                       | Docker Compose                   | Local database name (required by Compose)                                |
| `POSTGRES_PORT`                 | `5432`                                     | Docker Compose                   | Host port, bound to 127.0.0.1                                            |
| `OLLAMA_PORT`                   | `11434`                                    | Docker Compose (`ai` profile)    | Host port, bound to 127.0.0.1                                            |

## Security model

What the code enforces; the threat-by-threat review is in the [security review](docs/security/security-review.md).

- **Authentication:** Supabase issues access tokens. The API verifies each one itself, with
  Supabase's public keys (JWKS), the issuer, the audience and the expiry. Every route requires a
  token unless it is marked public: only the two health checks are.
- **Authorization:** every query is scoped to the caller. Another user's document is a 404, the
  same as a missing one, so ids cannot be probed. Composite foreign keys keep a job's owner equal
  to its document's owner.
- **Files:** the API checks each upload's bytes and stores it under a generated key in a private
  bucket. Files are only ever streamed back through the API to their owner, with the stored type
  and `nosniff`.
- **Untrusted document text:** prompts mark it as data, answers must match a JSON Schema, and every
  value is checked against the document before it can complete without a person.
- **Browser:** a strict Content-Security-Policy (only the app's own scripts; connections only to the
  API and Supabase), `frame-ancestors 'none'`, HSTS, and no server-rendered HTML.
- **Abuse:** per-user rate limits, a daily processing quota and a 10 MiB upload limit.
- **Secrets:** read from the environment and validated at startup. They are never logged (log keys
  are redacted), never sent to the browser, and never committed. Production secrets live only on
  the host.
- **Privacy:** the audit log records who did what, never document content. "Delete all my data"
  erases the user's documents and files ([ADR-010](docs/adr/010-data-retention-and-erasure.md)).

Known gaps: access tokens stay valid until they expire, even after sign-out; tokens are kept in
`localStorage`; MFA is not enforced; rate limits are per process
([authentication](docs/security/authentication.md#known-limitations)).

## API

The full reference, with every shape, status code and an example session, is in
[docs/api](docs/api/README.md). Paths below are under `/api/v1`; "Bearer" means a Supabase access
token is required.

| Method | Path                                      | Auth   | Description                                                                                                                                                      |
| ------ | ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                                 | None   | Liveness: `{ "status": "ok", "timestamp" }`                                                                                                                      |
| GET    | `/health/ready`                           | None   | Readiness: same body when the database answers; 503 otherwise                                                                                                    |
| GET    | `/me`                                     | Bearer | The signed-in user; creates the user record on first call                                                                                                        |
| DELETE | `/me`                                     | Bearer | Erases all your documents, files and your profile; 204 ([details](docs/adr/010-data-retention-and-erasure.md))                                                   |
| GET    | `/documents`                              | Bearer | The caller's documents: `q`, `status`, `type`, `format`, `sort`, `limit` (1–100, default 20), opaque `cursor` ([details](docs/documents/document-management.md)) |
| GET    | `/documents/:id`                          | Bearer | One of the caller's documents; 404 for other users' and unknown ids                                                                                              |
| GET    | `/documents/:id/content`                  | Bearer | The file; `disposition=inline` (preview) or `attachment` (default, download); audited; 404 if not yours                                                          |
| POST   | `/documents`                              | Bearer | Multipart upload, one `file` part (PDF/PNG/JPEG ≤ 10 MB); 201 with the document, queued for processing; 413/415/400 on rejection                                 |
| DELETE | `/documents/:id`                          | Bearer | Deletes the document and its file; 204, or 404 if it is not yours                                                                                                |
| GET    | `/documents/:id/jobs`                     | Bearer | The document's 20 most recent processing jobs: status, stage, attempts, error code ([details](docs/processing/job-queue.md))                                     |
| POST   | `/documents/:id/jobs`                     | Bearer | Reprocesses a failed or rejected document: 202 with the queued job (the active job if one exists); 409 once in review or completed                               |
| GET    | `/documents/:id/extraction`               | Bearer | Latest extraction with field scores, flags and review state ([details](docs/processing/review-workflow.md))                                                      |
| PUT    | `/documents/:id/extraction/fields/:field` | Bearer | Confirms or corrects one field while the document is in review                                                                                                   |
| POST   | `/documents/:id/extraction/approve`       | Bearer | Completes the document; 409 while flagged fields are unchecked                                                                                                   |
| POST   | `/documents/:id/extraction/reject`        | Bearer | Marks the document `rejected`, with an optional reason                                                                                                           |
| GET    | `/documents/:id/activity`                 | Bearer | The document's 50 most recent audit entries (its timeline); 404 if not yours                                                                                     |
| GET    | `/processing/summary`                     | Bearer | Your queue now, and the last 7 days' outcomes, failure codes and step durations                                                                                  |
| GET    | `/processing/jobs`                        | Bearer | Your 50 most recent jobs across documents; `?status=` filter                                                                                                     |
| GET    | `/audit-logs`                             | Bearer | Your actions and the system's actions on your documents, newest first; `?cursor=` paging                                                                         |
| GET    | `/analytics`                              | Bearer | Your analytics: `days` = 7, 30 or 90; `tz` = your IANA timezone                                                                                                  |

## Deployment

The demo runs on free tiers:

| Part              | Host                                                             |
| ----------------- | ---------------------------------------------------------------- |
| Web app           | Cloudflare Pages                                                 |
| API + worker      | Render free web service, from the `Dockerfile` and `render.yaml` |
| Database, sign-in | Supabase                                                         |
| Files             | Cloudflare R2 (private bucket)                                   |
| AI                | Cloudflare Workers AI                                            |

Every pull request and push runs `.github/workflows/ci.yml`: format, lint, types, migrations,
generated-types check, all tests with coverage, build, `npm audit`, and a smoke test of the
production image. A push to `main` deploys both sides once every check has passed. The
[deployment runbook](docs/operations/deployment.md) covers the one-time setup, secrets, the
post-deploy smoke test, rollback, logs and monthly housekeeping.

## Free-tier constraints

Checked on 2026-11-04. Free tiers change without notice.

| Provider         | Limit                                                                                                       | Effect                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Render           | Sleeps after 15 min idle (about a minute to wake); 512 MB, 0.1 CPU; no background workers                   | Slow first request; OCR about 46 s a page; worker in the API process |
| Supabase         | 500 MB database; paused after a week of low activity; built-in mailer sends only to team members, 2 an hour | Public sign-up needs custom SMTP                                     |
| Cloudflare R2    | 10 GB-month, 1M Class A and 10M Class B operations a month                                                  | Files never expire, so storage fills first                           |
| Workers AI       | 10,000 Neurons a day                                                                                        | About 27 documents a day                                             |
| Cloudflare Pages | 500 builds a month, 20,000 files                                                                            | Far above what the app needs                                         |
| GitHub Actions   | Free for public repositories; 2,000 minutes a month for private ones                                        | A CI run takes a few minutes                                         |

Sources, measurements and what runs out first as volume grows: [deployment](docs/operations/deployment.md#free-tier-limits)
and the [performance review](docs/operations/performance-review.md).

## Limitations

- **A demo, not a product.** No SLA, no monitoring or alerting, one instance. DocuMind runs no backups
  of its own; whatever the Supabase plan provides is all there is.
- **Accuracy:** three document types, English text only. Confidence is a rule-based review signal,
  not a probability. Auto-completed extractions are not checked by a person.
- **Free-host speed:** a long scan can take 15 minutes or more, and the host may sleep mid-job (the
  job is retried later). Text-layer PDFs process in seconds.
- **Processing is one job at a time per worker,** and the web app does not refresh a document's
  status on its own.
- **Retention:** files are kept until the user deletes them. There is no automatic expiry yet.
- **Erasure keeps the Supabase sign-in account,** which must be deleted in Supabase by hand.
- **Scale:** analytics and filename search slow down for a single account with many thousands of
  documents ([performance review](docs/operations/performance-review.md)).
- **Not independently tested** for security or accessibility beyond the automated checks.

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
- **Upload fails with 415 "not a valid PDF file"**: the file's bytes do not match its extension
  (for example a renamed Word document). Re-export it as a real PDF, PNG or JPEG.
- **Every API call returns 401 "Invalid access token" after signing in**: `SUPABASE_URL` does not
  match the project the web app signs in to, or the project still uses the legacy HS256 secret.
- **API calls return 503 after signing in**: the API cannot fetch the JWKS; the API log names the
  cause (check `SUPABASE_URL` and network access).
- **Password reset link opens the login page or says "Link expired"**: add
  `http://localhost:5173/reset-password` to the Supabase redirect allow-list, and open the link in
  the browser that requested it.
- **Jobs stay queued or fail with `ai_unavailable`**: no AI provider is reachable. Run
  `npm run ai:up`, then `npm run ai:check`.
- **Jobs fail with `ai_timeout` on CPU-only Ollama**: raise `AI_TIMEOUT_MS`, or use a smaller
  document.
- **Deployed web app cannot reach the API** (CORS or CSP errors in the console): `VITE_API_URL`
  (GitHub variable) and `CORS_ALLOWED_ORIGINS` (Render) must name each other's origin exactly, with
  no trailing slash.
- **Deployed API fails to start**: the Render log names the invalid variable, or the migration
  that failed. More in [deployment](docs/operations/deployment.md).

## Documentation

| Topic             | Document                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture      | [overview](docs/architecture/overview.md), [decision records](docs/adr/README.md)                                                                                                                                                |
| API               | [reference](docs/api/README.md)                                                                                                                                                                                                  |
| Database          | [schema, indexes, query patterns](docs/database/schema.md)                                                                                                                                                                       |
| Security          | [authentication](docs/security/authentication.md), [security review](docs/security/security-review.md)                                                                                                                           |
| Uploads and files | [uploads and storage](docs/storage/document-uploads.md), [document management](docs/documents/document-management.md)                                                                                                            |
| Processing        | [text extraction](docs/processing/text-extraction.md), [classification and extraction](docs/processing/document-extraction.md), [job queue](docs/processing/job-queue.md), [review workflow](docs/processing/review-workflow.md) |
| AI                | [providers, prompts, errors](docs/ai/ai-providers.md)                                                                                                                                                                            |
| Web app           | [UI foundation](docs/frontend/ui-foundation.md)                                                                                                                                                                                  |
| Operations        | [deployment](docs/operations/deployment.md), [observability](docs/operations/observability.md), [analytics](docs/operations/analytics.md), [performance review](docs/operations/performance-review.md)                           |
| Testing           | [testing strategy](docs/testing/testing-strategy.md)                                                                                                                                                                             |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch, commit and review conventions.
