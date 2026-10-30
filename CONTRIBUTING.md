# Contributing

## Branches

- `main` is always releasable.
- Work happens on short-lived branches named `feature/<topic>`, `fix/<topic>`, `docs/<topic>`,
  `refactor/<topic>` or `chore/<topic>`, merged into `main` through a pull request.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat: add document upload endpoint
fix: prevent duplicate processing jobs
test: cover document ownership authorization
refactor: isolate AI provider abstraction
docs: add ADR for asynchronous processing
chore: bump NestJS to 12.3
```

One logical change per commit. Do not mix refactors, features and formatting.

## Before opening a pull request

```bash
npm run check   # format check, lint, typecheck, all tests
npm audit
```

## Rules

- **Secrets** never enter the repository. `.env` is git-ignored; document new variables in
  `.env.example` and in the README.
- **Configuration** is read only through `apps/api/src/config/app-config.ts`; application code
  never reads `process.env` directly (test support reads `TEST_DATABASE_URL`).
- **Schema changes** happen only through migrations; follow the workflow in
  [docs/database/schema.md](docs/database/schema.md#migration-workflow). Never edit a migration that
  has run anywhere other than your machine; add a new one. Commit regenerated row types with it.
- **Database access** goes through repositories. Reads and deletes of user-owned data filter by
  owner id in SQL.
- **Authentication** is on by default for every route. `@Public()` needs a reason in a comment and
  a reviewer's agreement. Controllers take the caller from `@CurrentUser()` and pass its id to the
  repositories. Validate path ids (`ParseUUIDPipe`) and query/body input (shared Zod schemas).
- **Never log** access or refresh tokens, `Authorization` headers, passwords or document contents.
- **`VITE_*` variables are public**: they are bundled into the web app. Never put a secret in one.
- **Uploaded files are hostile input.** Never build a storage path from user input (use
  `documentStorageKey`), never trust the client's MIME type, and never render or execute an upload
  in the app's origin. Storage credentials stay in the API.
- **Web UI** is built from the kit in `apps/web/src/components/ui` and the tokens in `index.css`
  (see [docs/frontend/ui-foundation.md](docs/frontend/ui-foundation.md)). Every data view handles
  loading, empty and error states; error text is fixed, never the server's message; metrics without
  an API show "No data yet", never invented numbers. Interactive controls need an accessible name
  and keyboard support; keep `a11y.spec.tsx` passing.
- **Dependencies:** add one only with a clear reason; check `npm audit` afterwards. Install scripts
  are reviewed via `npm install-scripts ls`.
- **Architecture changes** that affect other phases get an ADR in `docs/adr/`.
