# ADR-021: Deployment pipeline

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

ADR-009 picked the hosts: Cloudflare Pages, a free Render web service, Supabase, R2 and Workers AI.
Phase 16 decides how code gets there. The constraints:

- Render's free plan has no pre-deploy command, no background workers, no cron and no shell.
- The web app and the API live on different origins (`*.pages.dev` and `*.onrender.com`).
- Nothing that fails CI may reach users, and no paid service may be added.
- Secrets should live in as few places as possible.

## Decision

- **API image.** A multi-stage Dockerfile on `node:24-bookworm-slim`, pinned by digest. It contains
  production dependencies only and runs as the `node` user. CI builds the same image and checks
  that it starts with production settings, under the free instance's memory limit.
- **Migrations on start.** The container runs `migrate latest` and then starts the API. If a
  migration fails, the process exits, the new instance never becomes healthy and Render keeps
  serving the old one. Kysely's migration lock serializes concurrent runs.
- **Worker in the API process** on the free host (`WORKER_IN_PROCESS=true`, ADR-009). Locally and
  on a paid host it stays a separate process.
- **Cross-origin API.** The web app calls `VITE_API_URL` with its Bearer token. The API's CORS
  allow-list holds the one Pages origin, and the web app's CSP `connect-src` names the API origin.
- **Gated deploys.** GitHub Actions runs the checks on every pull request and push. Render deploys
  the API only when every check on the commit has passed (`autoDeployTrigger: checksPass`). A job
  that needs the checks deploys the web app with `wrangler pages deploy`. Its only secret is a
  Pages:Edit token.
- **Host headers** for the web app in a Pages `_headers` file: `frame-ancestors`, HSTS,
  `X-Frame-Options`, `nosniff`, a referrer policy and a permissions policy.
- **Housekeeping by hand.** The orphan-file sweep's dry run and Supabase account deletion are
  monthly manual steps in the runbook, so no production database or R2 credentials live in GitHub.

## Alternatives

- **Migrations from CI** before triggering Render. This keeps them out of startup, but puts the
  production `DATABASE_URL` in GitHub, and the API deploy is no longer one step.
- **Render's native Node runtime** (no Dockerfile). Less to maintain, but CI could not test the
  exact artifact, and the free instance's limits could not be emulated locally.
- **A Pages Function proxying `/api`** to keep everything same-origin. An extra hop and extra code,
  it counts against the Workers request quota, and `_headers` do not apply to its responses.
- **Pages Git integration.** No secret in GitHub, but Cloudflare builds and ships every push,
  including commits that fail CI.
- **A scheduled sweep in GitHub Actions.** Automatic, but it needs production database and R2
  secrets in GitHub.

## Trade-offs

- Startup takes longer by the migration time, and a slow migration delays the deploy. Migrations
  must be backward compatible, because the old instance serves during them and a rollback does not
  revert them.
- Deploys of the web app and the API are separate, so for a short time one can be newer than the
  other. The API contract must stay backward compatible across one release.
- Cross-origin requests add a CORS preflight to most API calls (cached by the browser for a few
  seconds by default).
- Manual housekeeping is easy to forget.

## Consequences

- `.github/workflows/ci.yml`, `Dockerfile`, `.dockerignore`, `render.yaml` and
  `apps/web/public/_headers` are new.
- New settings: `WORKER_IN_PROCESS` (API) and `VITE_API_URL` (web build).
- The runbook is [docs/operations/deployment.md](../operations/deployment.md). The first real deploy
  must run its smoke test, including the pooler checks that could not run locally.
