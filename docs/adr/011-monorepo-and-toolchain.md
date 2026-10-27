# ADR-011: Monorepo layout and toolchain

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

The frontend and backend must agree on request/response contracts, share one lint/format/test
setup, and stay easy to set up with zero cost.

## Decision

- **npm workspaces** with three packages:
  - `apps/api`: NestJS application (ADR-001).
  - `apps/web`: React + Vite + Tailwind CSS.
  - `packages/shared`: Zod schemas and inferred types for API contracts.
- **Shared contracts.** Zod schemas are the single source of truth: the API types its responses with
  them, the web app validates responses at runtime with them. `packages/shared` is the only extra
  package; it exists because the web app and the API are separate build targets that need the same
  contracts. It is built to `dist/` with `tsc`.
- **TypeScript 6** with a strict shared base (`tsconfig.base.json`: `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, among others). Pinned below 7 because
  NestJS 12's official template and `typescript-eslint` 8 (`<6.1.0`) target TypeScript 6.
- **API module format: CommonJS.** NestJS 12 ships as ESM, and its official v12 application template
  stays CommonJS, loading Nest through Node's `require(esm)`. This avoids ESM's circular-import
  pitfalls with decorator metadata.
- **Plain `tsc` builds plus `node --watch` for development**, not the Nest CLI. Two entrypoints in
  one app would make two `nest start --watch` processes fight over `dist/`.
- **Vitest everywhere.** Vitest 5 on Vite 8 emits decorator metadata from `tsconfig.json`; verified
  by a dependency-injection test before removing the SWC plugin.
- **ESLint** (flat config, `typescript-eslint` strict type-checked rules) and **Prettier**.
- **Node 24**, enforced through `engines` and `engine-strict`.

## Alternatives

- **pnpm or Turborepo/Nx.** Better at large monorepos; unnecessary for three packages, and pnpm is
  not installed by default.
- **Jest (the Nest template default).** Would mean two test runners, since the web app uses Vitest.
- **Generating types from OpenAPI.** Worth reconsidering once the API surface is larger (Phase 17).

## Trade-offs

- `packages/shared` must be built before the API and web typecheck or test; the root scripts do this.
- The Vite dev server and the API use different module systems, which is invisible to code but
  matters for tooling configuration.

## Consequences

- `npm audit` runs across all workspaces from one lockfile. A transitive `multer` advisory
  (GHSA-q7qp-rjg7-q26m) is resolved by an `overrides` entry pinning `multer@^2.5.0`; remove it once
  `@nestjs/platform-express` depends on a patched version.
