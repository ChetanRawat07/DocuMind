# Architecture Decision Records

An ADR records one significant decision: the context, what was decided, the alternatives, and the
consequences. ADRs are immutable once accepted; a changed decision gets a new ADR that supersedes
the old one.

Numbers follow the development plan so each record traces back to it. Gaps are decisions the plan
schedules for later phases.

| ADR                                            | Title                                           | Status   | Decided in |
| ---------------------------------------------- | ----------------------------------------------- | -------- | ---------- |
| [001](001-modular-monolith.md)                 | Modular monolith, one Nest app, two entrypoints | Accepted | Phase 0    |
| [002](002-postgresql-system-of-record.md)      | PostgreSQL as the system of record              | Accepted | Phase 0    |
| [003](003-object-storage-for-documents.md)     | Object storage for document files               | Accepted | Phase 0    |
| [004](004-asynchronous-document-processing.md) | Asynchronous document processing                | Accepted | Phase 0    |
| [005](005-postgresql-job-queue.md)             | PostgreSQL-backed job queue (no RabbitMQ)       | Accepted | Phase 0    |
| 006                                            | AI provider abstraction                         | Planned  | Phase 7    |
| 007                                            | OCR strategy                                    | Planned  | Phase 6    |
| 008                                            | Retry and idempotency strategy                  | Planned  | Phase 9    |
| [009](009-zero-cost-deployment.md)             | Zero-cost deployment architecture               | Accepted | Phase 0    |
| 010                                            | Document retention strategy                     | Planned  | Later      |
| [011](011-monorepo-and-toolchain.md)           | Monorepo layout and toolchain                   | Accepted | Phase 0    |
| [012](012-kysely-and-sql-migrations.md)        | Kysely with hand-written SQL migrations         | Accepted | Phase 1    |
| [013](013-supabase-auth-bearer-jwks.md)        | Supabase Auth, bearer tokens verified via JWKS  | Accepted | Phase 2    |
| [014](014-hand-built-ui-kit.md)                | Hand-built UI kit on Tailwind CSS               | Accepted | Phase 3    |
| [015](015-uploads-through-the-api.md)          | Uploads through the API; storage adapters       | Accepted | Phase 4    |

New ADRs use [template.md](template.md).
