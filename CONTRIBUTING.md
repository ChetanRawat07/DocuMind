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
- **Configuration** is read only through `apps/api/src/config/app-config.ts`, never via
  `process.env` elsewhere.
- **Schema changes** happen only through migrations (from Phase 1).
- **Dependencies:** add one only with a clear reason; check `npm audit` afterwards. Install scripts
  are reviewed via `npm install-scripts ls`.
- **Architecture changes** that affect other phases get an ADR in `docs/adr/`.
