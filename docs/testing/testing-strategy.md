# Testing strategy

How DocuMind is tested, what each kind of test proves, and how the suite was checked for gaps in
Phase 14. Every test runs offline and deterministically: no live AI provider, Supabase project or
storage bucket is needed.

## Running the tests

| Command                                   | What runs                                                     |
| ----------------------------------------- | ------------------------------------------------------------- |
| `npm test`                                | Every package (the API's database tests need `infra:up`)      |
| `npm run test:coverage`                   | The same, with coverage; fails below each package's threshold |
| `npx vitest run --project unit`           | API tests without a database (in `apps/api`)                  |
| `npx vitest run --project integration`    | API tests against `TEST_DATABASE_URL` (in `apps/api`)         |
| `npx vitest run src/path/to/file.spec.ts` | One file (in its package)                                     |

The integration project drops and recreates the `_test` database on every run, runs its files one
at a time, and starts each test from empty tables.

## Layers

| Layer                    | Where                                                  | Runs against                                                            |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Unit                     | `apps/api/src/**/*.spec.ts`, `packages/shared`         | Pure functions and classes with fakes                                   |
| Integration              | `apps/api/src/**/*.integration.spec.ts`                | Real PostgreSQL: repositories, queue, worker, storage sweep             |
| API (HTTP)               | `apps/api/test/*.integration.spec.ts`, `*.e2e.spec.ts` | The Nest application over HTTP (Supertest), with real auth and database |
| Web components and pages | `apps/web/src/**/*.spec.tsx`                           | jsdom with Testing Library; fake auth client, fetch and XHR             |
| Accessibility            | `apps/web/src/a11y.spec.tsx`                           | axe-core over every page                                                |

There is no browser end-to-end suite yet. A smoke test of sign-in, upload, erasure and the CSP
against the real Supabase project belongs to deployment (Phase 16).

## Test doubles

Fakes replace only what is outside the process or is slow; the code under test runs unchanged.

| Real dependency       | Replaced by                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Supabase signing keys | `test/support/test-auth.ts`: a local ES256 key pair; tokens are real, signed JWTs                  |
| AI providers          | `test/support/scripted-ai.ts` (fixed answers); provider HTTP via stubbed `fetch`                   |
| R2 / S3               | A stubbed AWS SDK client in `s3-storage.spec.ts`; elsewhere a temporary folder                     |
| Documents             | `test/support/sample-documents.ts`: generated PDFs (text layer, scans, hidden text)                |
| OCR                   | Real tesseract.js with the bundled English data (offline); stubbed where only control flow matters |
| Browser auth (web)    | `src/test/fake-auth-client.ts`                                                                     |

## Coverage of the plan's test areas

| Area                  | Main tests                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business logic        | `assess-extraction.spec.ts` (confidence, business rules), `review-fields.spec.ts` (auto-approval), `evidence.spec.ts`, `visible-evidence` cases in `document-analysis.service.integration.spec.ts` |
| Validators            | `upload-validation.spec.ts`, `app-config.spec.ts`, shared schema specs, web `config.spec.ts`                                                                                                       |
| Authentication        | `access-token-verifier.spec.ts`, `test/auth.integration.spec.ts` (missing, invalid, expired and foreign-key tokens; signing keys unavailable → 503)                                                |
| Authorization / IDOR  | `test/auth.integration.spec.ts`, `documents-management`, `review`, `observability`, `security` (another user's id answers 404 on every route)                                                      |
| Upload and retrieval  | `test/documents-upload.integration.spec.ts`, `documents-management.integration.spec.ts`, `http-app.e2e.spec.ts`                                                                                    |
| Queue                 | `processing-jobs.repository.integration.spec.ts` (claim order, due time, leases, fencing, dead letter)                                                                                             |
| Worker                | `document-processor.integration.spec.ts`, `job-failure.spec.ts`, `polling-loop.spec.ts`, `worker-app.e2e.spec.ts`                                                                                  |
| OCR and text          | `text-extractor.spec.ts`, `text-extraction.integration.spec.ts`, `normalize-text.spec.ts`                                                                                                          |
| AI providers (mocked) | `providers.spec.ts` (HTTP errors, timeouts, Retry-After), `generate-structured.spec.ts` (answers that are not JSON, schema failures without echoed values)                                         |
| Failure scenarios     | Invalid and oversized files, encrypted and oversized PDFs, image bombs, OCR and AI failures, missing stored file, storage errors, expired tokens                                                   |
| Idempotency           | Duplicate job requests, a repeated reprocess of a queued document, a job saving its extraction twice (one row, one audit entry), deleting twice, no changes after a review decision                |
| Concurrency           | Concurrent enqueue, concurrent claims, a claim skipping a locked job, quota under concurrent uploads (row lock), concurrent user provisioning, approve and reject racing on one document           |
| Web                   | Pages, upload queue, API client (refresh on 401, sign-out), safe redirects, auth error text                                                                                                        |

## Checks of the suite itself (Phase 14)

- **Coverage** (lines): API 90%, web 95%, shared 79%. Thresholds sit about two points below, so a
  drop fails `npm run test:coverage`. Uncovered API code is mostly the CLI entrypoints
  (`src/cli`, `migrate.ts`, `seed.ts`, `main.ts`, `worker.ts`), which are thin wrappers run by
  hand. Shared's uncovered files are schema declarations; the API and web tests run them.
- **Mutation testing** (by hand): rules were broken one at a time to confirm a test fails.
  - API core logic: 21 mutations. The first pass caught 16. Four survivors were real gaps, now
    tested:
    - a due date on the issue date;
    - a file that starts like `%PDF-` but isn't one;
    - the pixel limit exactly at 25 MP;
    - a claim that waits for a locked job instead of skipping it.
      The fifth survivor is an equivalent mutant: `<=` vs `<` against the 5-cent tolerance, which
      floating-point sums cannot hit exactly.
  - Web: 8 of 8 caught (redirects, session refresh and sign-out, erase confirmation, upload
    checks).
  - Phase 13's security controls: 19 of 19.
- **Determinism**:
  - The API unit, web and shared suites pass with no network access, in a network namespace with
    only loopback.
  - The full API suite passed three runs in a row and one run in shuffled order.

## Writing a new test

- **Put it at the lowest layer that can prove it.** A rule is a unit test. A query is an
  integration test. Authorization is always an HTTP test, because the guard, pipes and repository
  must work together.
- **Every user-owned route** gets a test that another user's id answers 404.
- **For a race, control the timing.** Hold a transaction open, as the quota lock test and the
  skip-locked claim test do. Firing requests together usually doesn't overlap, so a missing lock
  goes unnoticed.
- **Use the fakes above** rather than mocking modules, and never call a live provider.
- **Break the code once to check the test.** A test that still passes with the rule removed proves
  nothing.
